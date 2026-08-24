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
      defaultServiceCommissionBps: 5000,
      defaultRetailCommissionBps: 1000,
      tipsInPayout: true,
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
  upsertStylistPlan,
  openPayPeriod,
  postPeriodSales,
  closePayPeriod,
  getStylistStatement,
  __resetStylistCommissionStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const stylistId = '00000000-0000-4000-8000-0000000000bb';

describe('stylist-commission-engine', () => {
  beforeEach(() => {
    __resetStylistCommissionStore();
    vi.clearAllMocks();
  });

  it('computes commission payout on close', async () => {
    await upsertStylistPlan(tenantId, actorId, {
      stylistId,
      payModel: 'commission',
      serviceCommissionBps: 5000,
      retailCommissionBps: 1000,
    });
    const period = await openPayPeriod(tenantId, actorId, {
      stylistId,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
    });
    await postPeriodSales(tenantId, actorId, period.id, {
      serviceSalesCents: 100000,
      retailSalesCents: 20000,
      tipsCents: 5000,
    });
    const closed = await closePayPeriod(tenantId, actorId, period.id);
    // 50% of 100000 + 10% of 20000 + tips = 50000 + 2000 + 5000 = 57000
    expect(closed.payoutCents).toBe(57000);
    expect(closed.status).toBe('closed');
  });

  it('applies booth rent on hybrid model', async () => {
    await upsertStylistPlan(tenantId, actorId, {
      stylistId,
      payModel: 'hybrid',
      serviceCommissionBps: 4000,
      retailCommissionBps: 0,
      boothRentCents: 15000,
    });
    const period = await openPayPeriod(tenantId, actorId, {
      stylistId,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-08',
    });
    await postPeriodSales(tenantId, actorId, period.id, {
      serviceSalesCents: 50000,
      tipsCents: 0,
    });
    const closed = await closePayPeriod(tenantId, actorId, period.id);
    // 40% of 50000 - 15000 = 20000 - 15000 = 5000
    expect(closed.payoutCents).toBe(5000);
  });

  it('rejects posting to closed period', async () => {
    await upsertStylistPlan(tenantId, actorId, {
      stylistId,
      payModel: 'commission',
    });
    const period = await openPayPeriod(tenantId, actorId, {
      stylistId,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-02',
    });
    await closePayPeriod(tenantId, actorId, period.id);
    await expect(
      postPeriodSales(tenantId, actorId, period.id, { serviceSalesCents: 100 }),
    ).rejects.toThrow(/closed/i);
    const stmt = await getStylistStatement(tenantId, actorId, period.id);
    expect(stmt.status).toBe('closed');
  });
});
