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
      finfishSpeciesHints: ['salmon', 'trout', 'finfish'],
      shellfishSpeciesHints: ['oyster', 'mussel', 'shellfish'],
      finfishPct24h: 2,
      finfishPct5d: 5,
      shellfishPct12m: 15,
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
  logMortality,
  logHealthObservation,
  getReportableEventStatus,
  setBatchInfoFn,
  seedDefaultReportableConditions,
  __resetAqHealthMortalityStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('aq-health-mortality', () => {
  beforeEach(() => {
    __resetAqHealthMortalityStore();
    vi.clearAllMocks();
    seedDefaultReportableConditions();
    setBatchInfoFn(async (_t, batchId) => {
      if (batchId === 'salmon-batch') {
        return { currentQuantity: 1000, species: 'Atlantic salmon' };
      }
      if (batchId === 'oyster-batch') {
        return { currentQuantity: 10000, species: 'Eastern oyster' };
      }
      return null;
    });
  });

  it('flags finfish mortality >2% in 24h', async () => {
    const ev = await logMortality(tenantId, actorId, {
      batchId: 'salmon-batch',
      quantity: 25, // 2.5%
      cause: 'unknown',
    });
    expect(ev.reportable).toBe(true);
    expect(ev.reviewStatus).toBe('pending_review');
    expect(ev.stockClass).toBe('finfish');
  });

  it('does not flag small mortality', async () => {
    const ev = await logMortality(tenantId, actorId, {
      batchId: 'salmon-batch',
      quantity: 5, // 0.5%
      cause: 'handling',
    });
    expect(ev.reportable).toBe(false);
  });

  it('flags reportable disease observation', async () => {
    const obs = await logHealthObservation(tenantId, actorId, {
      batchId: 'salmon-batch',
      condition: 'Infectious salmon anemia',
      diagnosticResult: 'PCR positive',
    });
    expect(obs.reportable).toBe(true);
    const status = await getReportableEventStatus(tenantId, 'salmon-batch');
    expect(status.pendingReviewCount).toBeGreaterThanOrEqual(1);
  });
});
