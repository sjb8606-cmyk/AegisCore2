import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../ai-gateway/src/index', () => ({
  generateText: vi.fn(),
}));

import {
  createForecastSeries,
  runForecast,
  simulateScenario,
  detectAnomalies,
  validateLlmOutput,
  ErrorCode,
} from '../index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { generateText } from '../../../ai-gateway/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SERIES_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateLlmOutput', () => {
  it('calls the real gateway and parses a valid JSON response', async () => {
    (generateText as any).mockResolvedValue({
      content: JSON.stringify({ approved: true }),
    });

    const result = await validateLlmOutput('some text', {});
    expect(result).toEqual({ approved: true });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'groq' })
    );
  });

  it('throws INTERNAL when the model does not return valid JSON', async () => {
    (generateText as any).mockResolvedValue({ content: 'not json at all' });

    await expect(validateLlmOutput('some text', {})).rejects.toMatchObject({
      code: ErrorCode.INTERNAL,
    });
  });
});

describe('runForecast', () => {
  it('throws BAD_REQUEST when there is not enough real historical data', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SERIES_ID, metric_name: 'daily_catch_kg', granularity: 'day' }])
      .mockResolvedValueOnce([{ actual_value: 100 }]);

    await expect(runForecast(TENANT_ID, SERIES_ID, 7)).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it('projects real future points from real historical data via the gateway', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SERIES_ID, metric_name: 'daily_catch_kg', granularity: 'day' }])
      .mockResolvedValueOnce([
        { timestamp: '2026-07-01T00:00:00Z', actual_value: 100 },
        { timestamp: '2026-07-02T00:00:00Z', actual_value: 110 },
        { timestamp: '2026-07-03T00:00:00Z', actual_value: 105 },
      ])
      .mockResolvedValueOnce([]);

    (generateText as any).mockResolvedValue({
      content: JSON.stringify({
        projected_values: [
          { timestamp: '2026-07-04T00:00:00Z', predicted_value: 108, confidence: 0.7 },
        ],
      }),
    });

    const result = await runForecast(TENANT_ID, SERIES_ID, 1);
    expect(result.points_generated).toBe(1);

    const insertCall = (withTenantQuery as any).mock.calls.find((call: any[]) =>
      call[0].includes('INSERT INTO forecast_values')
    );
    expect(insertCall[1]).toContain('groq/llama-4-scout-17b-16e-instruct');
  });
});

describe('detectAnomalies', () => {
  it('throws BAD_REQUEST when there is not enough real historical data', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ actual_value: 100 }]);

    await expect(detectAnomalies(TENANT_ID, SERIES_ID)).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it('returns null (no fabricated anomaly) when the latest value is not actually an outlier', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { actual_value: 100 }, { actual_value: 102 }, { actual_value: 98 }, { actual_value: 101 },
    ]);

    const result = await detectAnomalies(TENANT_ID, SERIES_ID);
    expect(result).toBeNull();
  });

  it('records a real, data-derived anomaly when the latest value genuinely is a statistical outlier', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([
        { actual_value: 100 }, { actual_value: 102 }, { actual_value: 98 }, { actual_value: 500 },
      ])
      .mockResolvedValueOnce([{ id: 'anomaly-1', anomaly_type: 'spike', detected_value: 500 }]);

    const result = await detectAnomalies(TENANT_ID, SERIES_ID);
    expect(result).not.toBeNull();

    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1][3]).toBe('spike');
    expect(insertCall[1][5]).toBe(500);
  });
});

describe('regression guard — old fabricated constants are gone from the source', () => {
  it('the source file no longer contains the old hardcoded fake values', () => {
    const sourcePath = path.resolve(__dirname, '../index.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('arima-v1.1');
    expect(source).not.toContain('prophet-v2.0-ensemble');
    expect(source).not.toContain('Supply chain bottleneck on colorant dyes');
    expect(source).not.toContain('350.00');
    expect(source).not.toContain('115.00');
  });
});
