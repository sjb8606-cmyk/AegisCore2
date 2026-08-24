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
      maxOpenCyclesPerField: 2,
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
vi.mock('@platform/hash-chain', () => ({
  GENESIS_HASH: '0'.repeat(64),
  computeChainHash: (prev: string, body: unknown) => {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(prev + JSON.stringify(body))
      .digest('hex');
  },
}));

import {
  startCropCycle,
  logEvent,
  getCycleHistory,
  closeCropCycle,
  __resetAgCropCycleStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const fieldId = 'field-1';

describe('ag-crop-cycle', () => {
  beforeEach(() => {
    __resetAgCropCycleStore();
    vi.clearAllMocks();
  });

  it('starts cycle, logs chained events, closes with harvest lot', async () => {
    const cycle = await startCropCycle(tenantId, actorId, {
      fieldId,
      cropType: 'potato',
      plannedPlantDate: '2026-05-01',
    });
    const e1 = await logEvent(tenantId, actorId, cycle.id, {
      eventType: 'planting',
      payload: { seedLot: 'SL-1' },
    });
    const e2 = await logEvent(tenantId, actorId, cycle.id, {
      eventType: 'irrigation',
      payload: { mm: 12 },
    });
    expect(e2.prevHash).toBe(e1.chainHash);
    expect(e1.chainHash).not.toBe(e1.prevHash);

    const closed = await closeCropCycle(tenantId, actorId, cycle.id, {
      finalYieldKg: 15000,
    });
    expect(closed.status).toBe('closed');
    expect(closed.harvestLotId).toBeTruthy();

    const hist = await getCycleHistory(tenantId, cycle.id);
    expect(hist.events.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects events on closed cycle', async () => {
    const cycle = await startCropCycle(tenantId, actorId, {
      fieldId,
      cropType: 'barley',
      plannedPlantDate: '2026-04-15',
    });
    await closeCropCycle(tenantId, actorId, cycle.id, { finalYieldKg: 100 });
    await expect(
      logEvent(tenantId, actorId, cycle.id, {
        eventType: 'irrigation',
        payload: {},
      }),
    ).rejects.toThrow(/closed/i);
  });

  it('limits open cycles per field', async () => {
    await startCropCycle(tenantId, actorId, {
      fieldId,
      cropType: 'a',
      plannedPlantDate: '2026-01-01',
    });
    await startCropCycle(tenantId, actorId, {
      fieldId,
      cropType: 'b',
      plannedPlantDate: '2026-01-02',
    });
    await expect(
      startCropCycle(tenantId, actorId, {
        fieldId,
        cropType: 'c',
        plannedPlantDate: '2026-01-03',
      }),
    ).rejects.toThrow(/Too many open/i);
  });
});
