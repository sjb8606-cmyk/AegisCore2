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
      powerRateCentsPerKwh: 25,
      waterRateCentsPerM3: 400,
      requireMonotonicMeters: true,
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
  recordReading,
  getSlipUsage,
  getMeterState,
  __resetSlipMeteringStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const slipId = 'slip-12';

describe('slip-power-water-metering', () => {
  beforeEach(() => {
    __resetSlipMeteringStore();
    vi.clearAllMocks();
  });

  it('records power usage and charges', async () => {
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'power',
      reading: 100,
    });
    const r2 = await recordReading(tenantId, actorId, {
      slipId,
      kind: 'power',
      reading: 120,
    });
    expect(r2.usage).toBe(20);
    expect(r2.chargeCents).toBe(500); // 20 * 25
  });

  it('aggregates power and water for a period', async () => {
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'power',
      reading: 10,
    });
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'power',
      reading: 15,
    });
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'water',
      reading: 1,
    });
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'water',
      reading: 3,
    });
    const usage = await getSlipUsage(
      tenantId,
      actorId,
      slipId,
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(usage.powerUsage).toBe(15); // 10 first install + 5 delta — first reading usage from 0 is 10
    expect(usage.waterUsage).toBe(3);
  });

  it('rejects decreasing meter when monotonic required', async () => {
    await recordReading(tenantId, actorId, {
      slipId,
      kind: 'power',
      reading: 50,
    });
    await expect(
      recordReading(tenantId, actorId, {
        slipId,
        kind: 'power',
        reading: 40,
      }),
    ).rejects.toThrow(/lower than previous/i);
    const state = await getMeterState(tenantId, actorId, slipId, 'power');
    expect(state.lastReading).toBe(50);
  });
});
