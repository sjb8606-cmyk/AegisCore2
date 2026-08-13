import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn() };

vi.mock('@platform/tenancy', () => {
  async function withTenantTransaction(fn: (client: any) => Promise<any>, tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID Mandatory');
    await mockClient.query('BEGIN');
    await mockClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(mockClient);
    await mockClient.query('COMMIT');
    return result;
  }
  return {
    withTenant: (tenantId: string, fn: (client: any) => Promise<any>) => withTenantTransaction(fn, tenantId),
    withTenantQuery: (sql: string, params: any[], tenantId: string) =>
      withTenantTransaction(async (client) => (await client.query(sql, params)).rows, tenantId),
  };
});

vi.mock('@platform/lot-traceability', () => ({
  LotTraceabilityService: { getLot: vi.fn() },
}));

vi.mock('@platform/recall-engine', () => ({
  RecallEngineService: { cascadeHold: vi.fn() },
}));

import { TemperatureEngineService } from '../index';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { RecallEngineService } from '@platform/recall-engine';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const THRESHOLD_ID = '44444444-4444-4444-4444-444444444444';
const READING_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  (LotTraceabilityService.getLot as any).mockResolvedValue({ id: LOT_ID, metadata: {} });
});

describe('TemperatureEngineService.logReading — no threshold configured', () => {
  it('logs the reading honestly as hasThreshold=false, never fabricates a check, no hold triggered', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: READING_ID, reading_celsius: 3 }] })
      .mockResolvedValueOnce(undefined);

    const result = await TemperatureEngineService.logReading(TENANT_ID, USER_ID, LOT_ID, {
      stage: 'storage',
      readingCelsius: 3,
    });

    expect(result.hasThreshold).toBe(false);
    expect(result.isDeviation).toBe(false);
    expect(result.holdReport).toBeNull();
    expect(RecallEngineService.cascadeHold).not.toHaveBeenCalled();
  });
});

describe('TemperatureEngineService.logReading — within threshold', () => {
  it('does not trigger a hold when the reading is inside the acceptable range', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: THRESHOLD_ID, min_celsius: '0.00', max_celsius: '4.00' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: READING_ID, reading_celsius: 2 }] })
      .mockResolvedValueOnce(undefined);

    const result = await TemperatureEngineService.logReading(TENANT_ID, USER_ID, LOT_ID, {
      stage: 'storage',
      readingCelsius: 2,
    });

    expect(result.hasThreshold).toBe(true);
    expect(result.isDeviation).toBe(false);
    expect(RecallEngineService.cascadeHold).not.toHaveBeenCalled();
  });
});

describe('TemperatureEngineService.logReading — deviation triggers a real hold cascade', () => {
  it('cascades a hold when the reading is above the max threshold', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: THRESHOLD_ID, min_celsius: '0.00', max_celsius: '4.00' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: READING_ID, reading_celsius: 8 }] })
      .mockResolvedValueOnce(undefined);

    (RecallEngineService.cascadeHold as any).mockResolvedValue({
      sourceLotId: LOT_ID, totalTargeted: 1, heldCount: 1, failedCount: 0, results: [],
    });

    const result = await TemperatureEngineService.logReading(TENANT_ID, USER_ID, LOT_ID, {
      stage: 'storage',
      readingCelsius: 8,
    });

    expect(result.isDeviation).toBe(true);
    expect(result.holdReport).not.toBeNull();
    expect(RecallEngineService.cascadeHold).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      LOT_ID,
      expect.objectContaining({
        reason: expect.stringContaining('8\u00b0C outside [0.00, 4.00]\u00b0C at storage'),
      }),
    );
  });

  it('cascades a hold when the reading is below the min threshold', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: THRESHOLD_ID, min_celsius: '0.00', max_celsius: '4.00' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: READING_ID, reading_celsius: -3 }] })
      .mockResolvedValueOnce(undefined);

    (RecallEngineService.cascadeHold as any).mockResolvedValue({
      sourceLotId: LOT_ID, totalTargeted: 1, heldCount: 1, failedCount: 0, results: [],
    });

    const result = await TemperatureEngineService.logReading(TENANT_ID, USER_ID, LOT_ID, {
      stage: 'storage',
      readingCelsius: -3,
    });

    expect(result.isDeviation).toBe(true);
    expect(RecallEngineService.cascadeHold).toHaveBeenCalledTimes(1);
  });
});

describe('TemperatureEngineService.getThreshold — species-specific vs generic fallback', () => {
  it('prefers a species-specific threshold when one exists', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'species-specific-id', min_celsius: '-1.00', max_celsius: '2.00' }] })
      .mockResolvedValueOnce(undefined);

    const threshold = await TemperatureEngineService.getThreshold(TENANT_ID, 'species-123', 'receiving');
    expect(threshold.id).toBe('species-specific-id');
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  it('falls back to the generic stage default when no species-specific threshold exists', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'generic-default-id', min_celsius: '0.00', max_celsius: '4.00' }] })
      .mockResolvedValueOnce(undefined);

    const threshold = await TemperatureEngineService.getThreshold(TENANT_ID, 'species-123', 'receiving');
    expect(threshold.id).toBe('generic-default-id');
  });
});

describe('TemperatureEngineService.setThreshold', () => {
  it('rejects when maxCelsius is less than minCelsius, before any database call', async () => {
    await expect(
      TemperatureEngineService.setThreshold(TENANT_ID, USER_ID, {
        stage: 'storage',
        minCelsius: 10,
        maxCelsius: 2,
      }),
    ).rejects.toThrow();

    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

describe('TemperatureEngineService.getReadingsForLot', () => {
  it('returns the real reading history for a lot', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: READING_ID, reading_celsius: 2 }] })
      .mockResolvedValueOnce(undefined);

    const readings = await TemperatureEngineService.getReadingsForLot(TENANT_ID, LOT_ID);
    expect(readings).toEqual([{ id: READING_ID, reading_celsius: 2 }]);
  });
});
