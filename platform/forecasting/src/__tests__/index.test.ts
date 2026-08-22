import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      entityType: 'inventory',
      signals: [],
      retrainCadenceHours: 24,
      defaultHorizon: 7,
      minHistoryPoints: 3,
      modelVersion: 'ma-trend-v1',
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  ingestHistory,
  refreshModel,
  predict,
  trainModel,
  __resetForecastingStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const entityId = 'sku-boat-anchor';

describe('forecasting', () => {
  beforeEach(() => {
    __resetForecastingStore();
    vi.clearAllMocks();
  });

  it('trains slope on rising series', () => {
    const fit = trainModel([10, 20, 30, 40]);
    expect(fit.slope).toBeGreaterThan(0);
    expect(fit.mean).toBe(25);
  });

  it('ingests history and predicts', async () => {
    await ingestHistory(tenantId, actorId, {
      entityId,
      points: [
        { timestamp: '2026-01-01T00:00:00Z', value: 10 },
        { timestamp: '2026-01-02T00:00:00Z', value: 12 },
        { timestamp: '2026-01-03T00:00:00Z', value: 14 },
        { timestamp: '2026-01-04T00:00:00Z', value: 16 },
      ],
    });
    await refreshModel(tenantId, actorId, entityId);
    const preds = await predict(tenantId, actorId, {
      entityId,
      horizon: 3,
    });
    expect(preds).toHaveLength(3);
    expect(preds[0].confidence).toBeGreaterThan(0);
    expect(preds[0].modelVersion).toBe('ma-trend-v1');
  });

  it('rejects insufficient history', async () => {
    await ingestHistory(tenantId, actorId, {
      entityId,
      points: [{ timestamp: '2026-01-01T00:00:00Z', value: 1 }],
    });
    await expect(
      refreshModel(tenantId, actorId, entityId),
    ).rejects.toThrow(/insufficient/i);
  });
});
