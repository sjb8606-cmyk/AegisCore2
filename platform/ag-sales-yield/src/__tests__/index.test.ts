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
      defaultLaborCostPerCycle: 100,
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
  recordSale,
  calculateGrossMargin,
  getYieldSummary,
  setCycleCostHint,
  listSales,
  __resetAgSalesYieldStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ag-sales-yield', () => {
  beforeEach(() => {
    __resetAgSalesYieldStore();
    vi.clearAllMocks();
  });

  it('records sale and computes gross margin', async () => {
    setCycleCostHint({
      cropCycleId: 'cycle-1',
      inputCost: 500,
      laborCost: 200,
      acres: 40,
      yieldKg: 20000,
    });
    await recordSale(tenantId, actorId, {
      harvestLotId: 'hl-1',
      cropCycleId: 'cycle-1',
      fieldId: 'field-1',
      buyerName: 'Co-op',
      quantitySold: 1000,
      pricePerUnit: 1.25,
    });
    const margin = await calculateGrossMargin(tenantId, 'cycle-1');
    expect(margin.totalSales).toBe(1250);
    expect(margin.inputCosts).toBe(500);
    expect(margin.laborCosts).toBe(200);
    expect(margin.grossMargin).toBe(550);
    expect((await listSales(tenantId, 'hl-1')).length).toBe(1);
  });

  it('rejects invalid quantities', async () => {
    await expect(
      recordSale(tenantId, actorId, {
        harvestLotId: 'hl',
        buyerName: 'X',
        quantitySold: 0,
        pricePerUnit: 1,
      }),
    ).rejects.toThrow(/quantitySold/i);
  });

  it('summarizes yield per acre', async () => {
    setCycleCostHint({
      cropCycleId: 'c1',
      inputCost: 0,
      laborCost: 0,
      acres: 10,
      yieldKg: 5000,
    });
    await recordSale(tenantId, actorId, {
      harvestLotId: 'h1',
      cropCycleId: 'c1',
      fieldId: 'f1',
      buyerName: 'Buyer',
      quantitySold: 100,
      pricePerUnit: 2,
    });
    const summary = await getYieldSummary(tenantId, { fieldId: 'f1' });
    expect(summary.yieldPerAcre).toBe(500);
    expect(summary.saleRevenue).toBe(200);
  });
});
