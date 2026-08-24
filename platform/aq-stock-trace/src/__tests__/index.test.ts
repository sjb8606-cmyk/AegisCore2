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
      requireHealthCertificate: true,
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
  introduceStock,
  assignToHoldingUnit,
  logGrowthEvent,
  getBatchHistory,
  closeBatch,
  setSiteAuthFn,
  __resetAqStockTraceStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('aq-stock-trace', () => {
  beforeEach(() => {
    __resetAqStockTraceStore();
    vi.clearAllMocks();
    setSiteAuthFn(async () => true);
  });

  it('introduces stock, assigns unit, chains events, closes', async () => {
    const batch = await introduceStock(tenantId, actorId, {
      siteId: 'site-1',
      species: 'Atlantic salmon',
      quantity: 10000,
      initialBiomassKg: 500,
      healthCertificateId: 'HC-1',
    });
    await assignToHoldingUnit(tenantId, actorId, {
      batchId: batch.id,
      holdingUnitId: 'cage-A',
    });
    const e1 = await logGrowthEvent(tenantId, actorId, batch.id, {
      eventType: 'feeding',
      payload: { feedKg: 40 },
    });
    const e2 = await logGrowthEvent(tenantId, actorId, batch.id, {
      eventType: 'measurement',
      payload: { avgWeightG: 55 },
    });
    expect(e2.prevHash).toBe(e1.chainHash);

    const closed = await closeBatch(tenantId, actorId, batch.id, {
      harvestEventId: 'harvest-9',
    });
    expect(closed.status).toBe('harvested');
    const hist = await getBatchHistory(tenantId, batch.id);
    expect(hist.events.length).toBeGreaterThanOrEqual(3);
  });

  it('blocks unauthorized species', async () => {
    setSiteAuthFn(async () => false);
    await expect(
      introduceStock(tenantId, actorId, {
        siteId: 'site-1',
        species: 'illegal-fish',
        quantity: 10,
        initialBiomassKg: 1,
        healthCertificateId: 'HC',
      }),
    ).rejects.toThrow(/not authorized/i);
  });

  it('requires health certificate', async () => {
    await expect(
      introduceStock(tenantId, actorId, {
        siteId: 'site-1',
        species: 'mussel',
        quantity: 1000,
        initialBiomassKg: 50,
      }),
    ).rejects.toThrow(/healthCertificateId/i);
  });
});
