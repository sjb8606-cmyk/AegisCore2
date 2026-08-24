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
      requireHealthCertOnTransfer: true,
      shellfishCultureHints: ['oyster', 'mussel', 'shellfish'],
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
  requestTransfer,
  recordHarvest,
  recordSale,
  traceLotUpstream,
  traceLotDownstream,
  setHarvestEligibilityFn,
  setBatchSpeciesFn,
  __resetAqHarvestTraceStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('aq-harvest-trace', () => {
  beforeEach(() => {
    __resetAqHarvestTraceStore();
    vi.clearAllMocks();
    setHarvestEligibilityFn(async () => ({ eligible: true, reason: null }));
    setBatchSpeciesFn(async () => ({
      species: 'Eastern oyster',
      siteId: 'site-1',
    }));
  });

  it('blocks transfer without health certificate', async () => {
    await expect(
      requestTransfer(tenantId, actorId, {
        batchId: 'b1',
        fromSiteId: 's1',
        toSiteId: 's2',
      }),
    ).rejects.toThrow(/healthCertificateId/i);
  });

  it('harvests, sells, and traces lots', async () => {
    const transfer = await requestTransfer(tenantId, actorId, {
      batchId: 'b1',
      fromSiteId: 's1',
      toSiteId: 's2',
      healthCertificateId: 'HC-9',
    });
    expect(transfer.status).toBe('approved');

    const harvest = await recordHarvest(tenantId, actorId, {
      batchId: 'b1',
      siteId: 'site-1',
      quantity: 500,
      weightKg: 120,
      grade: 'A',
    });
    expect(harvest.lotCode).toMatch(/^AQ-/);

    const sale = await recordSale(tenantId, actorId, {
      harvestId: harvest.id,
      buyerName: 'Seafood Co',
      quantitySold: 200,
    });
    const up = await traceLotUpstream(tenantId, sale.lotCode);
    expect(up).toContain(harvest.lotCode);
    const down = await traceLotDownstream(tenantId, harvest.lotCode);
    expect(down).toContain(sale.lotCode);
  });

  it('blocks shellfish harvest when CSSP not eligible', async () => {
    setHarvestEligibilityFn(async () => ({
      eligible: false,
      reason: 'CSSP classification: prohibited',
    }));
    await expect(
      recordHarvest(tenantId, actorId, {
        batchId: 'b1',
        siteId: 'site-1',
        quantity: 10,
        weightKg: 2,
      }),
    ).rejects.toThrow(/CSSP/i);
  });
});
