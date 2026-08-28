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
      defaultStackPolicy: 'none',
      maxCodesPerCart: 2,
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
  createPromotion,
  validateCode,
  applyToCart,
  recordRedemption,
  __resetPromotionEngineStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('promotion-engine', () => {
  beforeEach(() => {
    __resetPromotionEngineStore();
    vi.clearAllMocks();
  });

  it('validates percent code against subtotal', async () => {
    await createPromotion(tenantId, actorId, {
      code: 'SAVE10',
      discountType: 'percent',
      discountValue: 10,
      minSubtotalCents: 5000,
    });
    const result = await validateCode(tenantId, actorId, 'save10', 10000);
    expect(result.discountCents).toBe(1000);
  });

  it('applies fixed discount and records redemption', async () => {
    const promo = await createPromotion(tenantId, actorId, {
      code: 'FIVEOFF',
      discountType: 'fixed_cents',
      discountValue: 500,
    });
    const applied = await applyToCart(tenantId, actorId, {
      cartId: 'cart-1',
      codes: ['FIVEOFF'],
      subtotalCents: 3000,
    });
    expect(applied.totalDiscountCents).toBe(500);
    const red = await recordRedemption(tenantId, actorId, {
      cartId: 'cart-1',
      promotionId: promo.id,
      discountCents: 500,
    });
    expect(red.redemptionId).toBeTruthy();
  });

  it('rejects stack of non-stacking codes and low subtotal', async () => {
    await createPromotion(tenantId, actorId, {
      code: 'A',
      discountType: 'percent',
      discountValue: 10,
      stackPolicy: 'none',
    });
    await createPromotion(tenantId, actorId, {
      code: 'B',
      discountType: 'fixed_cents',
      discountValue: 100,
      stackPolicy: 'none',
    });
    await expect(
      applyToCart(tenantId, actorId, {
        cartId: 'c',
        codes: ['A', 'B'],
        subtotalCents: 5000,
      }),
    ).rejects.toThrow(/stack/i);

    await createPromotion(tenantId, actorId, {
      code: 'BIG',
      discountType: 'percent',
      discountValue: 10,
      minSubtotalCents: 10000,
    });
    await expect(
      validateCode(tenantId, actorId, 'BIG', 100),
    ).rejects.toThrow(/minimum/i);
  });
});
