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
      defaultTtlSeconds: 900,
      allowOversell: false,
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
  setOnHand,
  reserve,
  commitOnOrder,
  releaseCart,
  getAvailability,
  __resetAllocationInventoryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const sku = 'SKU-RED-SHIRT';

describe('allocation-inventory', () => {
  beforeEach(() => {
    __resetAllocationInventoryStore();
    vi.clearAllMocks();
  });

  it('reserves and reduces availability', async () => {
    await setOnHand(tenantId, actorId, sku, 10);
    await reserve(tenantId, actorId, {
      cartId: 'cart-1',
      sku,
      quantity: 3,
    });
    const avail = await getAvailability(tenantId, actorId, sku);
    expect(avail.available).toBe(7);
    expect(avail.reserved).toBe(3);
  });

  it('commits cart and decrements onHand', async () => {
    await setOnHand(tenantId, actorId, sku, 10);
    await reserve(tenantId, actorId, {
      cartId: 'cart-2',
      sku,
      quantity: 4,
    });
    const result = await commitOnOrder(tenantId, actorId, 'cart-2');
    expect(result.committed).toHaveLength(1);
    const avail = await getAvailability(tenantId, actorId, sku);
    expect(avail.onHand).toBe(6);
    expect(avail.reserved).toBe(0);
  });

  it('blocks oversell and releases cart', async () => {
    await setOnHand(tenantId, actorId, sku, 2);
    await expect(
      reserve(tenantId, actorId, {
        cartId: 'cart-3',
        sku,
        quantity: 5,
      }),
    ).rejects.toThrow(/insufficient/i);
    await reserve(tenantId, actorId, {
      cartId: 'cart-4',
      sku,
      quantity: 2,
    });
    await releaseCart(tenantId, actorId, 'cart-4');
    const avail = await getAvailability(tenantId, actorId, sku);
    expect(avail.available).toBe(2);
  });
});
