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
      allowNegative: false,
      lowStockThreshold: 5,
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
  createSalonSku,
  receiveStock,
  transferBin,
  consumeBackbar,
  sellRetail,
  listLowStock,
  __resetRetailBackbarStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('retail-backbar-inventory', () => {
  beforeEach(() => {
    __resetRetailBackbarStore();
    vi.clearAllMocks();
  });

  it('receives and transfers retail to backbar', async () => {
    const sku = await createSalonSku(tenantId, actorId, {
      skuCode: 'COLOR-7N',
      name: 'Color 7N',
    });
    await receiveStock(tenantId, actorId, {
      skuId: sku.id,
      bin: 'retail',
      quantity: 20,
    });
    const moved = await transferBin(tenantId, actorId, {
      skuId: sku.id,
      fromBin: 'retail',
      toBin: 'backbar',
      quantity: 5,
    });
    expect(moved.retailQty).toBe(15);
    expect(moved.backbarQty).toBe(5);
  });

  it('consumes backbar on service and sells retail', async () => {
    const sku = await createSalonSku(tenantId, actorId, {
      skuCode: 'SHAMPOO',
      name: 'Shampoo',
      retailQty: 10,
      backbarQty: 8,
    });
    const afterUse = await consumeBackbar(tenantId, actorId, {
      skuId: sku.id,
      quantity: 1,
      visitId: crypto.randomUUID(),
    });
    expect(afterUse.backbarQty).toBe(7);
    const afterSale = await sellRetail(tenantId, actorId, {
      skuId: sku.id,
      quantity: 2,
    });
    expect(afterSale.retailQty).toBe(8);
  });

  it('blocks oversell and lists low stock', async () => {
    const sku = await createSalonSku(tenantId, actorId, {
      skuCode: 'LOW',
      name: 'Low item',
      retailQty: 2,
      backbarQty: 1,
    });
    await expect(
      sellRetail(tenantId, actorId, { skuId: sku.id, quantity: 5 }),
    ).rejects.toThrow(/insufficient/i);
    const low = await listLowStock(tenantId, actorId);
    expect(low.some((s) => s.id === sku.id)).toBe(true);
  });
});
