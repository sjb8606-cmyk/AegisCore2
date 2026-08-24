import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetLoadVehicleBasedPricingStore,
  applySurcharge,
  calculatePrice,
  getFinalPrice
} from '../index';

describe('load-vehicle-based-pricing', () => {
  beforeEach(() => {
    __resetLoadVehicleBasedPricingStore();
  });

  it('calculates a price from distance and load factor', async () => {
    const tenantId = crypto.randomUUID();

    const pricing = await calculatePrice(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      10,
      5
    );

    expect(pricing.baseRate).toBe(100);
    expect(pricing.distanceMiles).toBe(10);
    expect(pricing.volumeOrSizeFactor).toBe(5);
    expect(pricing.totalPrice).toBe(170);
  });

  it('applies a surcharge and updates the final price', async () => {
    const tenantId = crypto.randomUUID();

    const pricing = await calculatePrice(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      10,
      5
    );

    const updated = await applySurcharge(
      tenantId,
      crypto.randomUUID(),
      pricing.pricingId,
      'Difficult access',
      25
    );

    expect(updated.surcharges).toHaveLength(1);
    expect(updated.totalPrice).toBe(195);

    const finalPrice = await getFinalPrice(
      tenantId,
      crypto.randomUUID(),
      pricing.pricingId
    );

    expect(finalPrice).toBe(195);
  });

  it('prevents another tenant from reading the pricing record', async () => {
    const tenantId = crypto.randomUUID();

    const pricing = await calculatePrice(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      5,
      2
    );

    await expect(
      getFinalPrice(
        crypto.randomUUID(),
        crypto.randomUUID(),
        pricing.pricingId
      )
    ).rejects.toThrow();
  });
});
