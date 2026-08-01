import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryService, ErrorCode } from '../index';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InventoryService.createItem', () => {
  it('creates a real item with the given name and sku', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ITEM_ID, name: 'Atlantic Salmon', sku: 'FISH-SALMON-01' },
    ]);

    const result = await InventoryService.createItem(TENANT_ID, USER_ID, {
      name: 'Atlantic Salmon',
      sku: 'FISH-SALMON-01',
    });

    expect(result.name).toBe('Atlantic Salmon');
    expect(withTenantQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO inventory_items'),
      [TENANT_ID, 'Atlantic Salmon', 'FISH-SALMON-01'],
      TENANT_ID
    );
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      InventoryService.createItem(TENANT_ID, 'not-a-uuid', { name: 'x', sku: 'y' })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws a validation error when name is missing', async () => {
    await expect(
      InventoryService.createItem(TENANT_ID, USER_ID, { sku: 'y' })
    ).rejects.toThrow();
  });
});

describe('InventoryService.recordMovement', () => {
  it('throws NOT_FOUND when the item does not belong to the tenant (no fake item is ever created)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      InventoryService.recordMovement(TENANT_ID, USER_ID, {
        itemId: ITEM_ID,
        type: 'receive',
        quantity: 10,
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const insertCalls = (withTenantQuery as any).mock.calls.filter((call: any[]) =>
      call[0].includes('INSERT INTO inventory_items')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('throws a validation error when itemId is missing entirely (itemId is now required)', async () => {
    await expect(
      InventoryService.recordMovement(TENANT_ID, USER_ID, { type: 'receive', quantity: 5 })
    ).rejects.toThrow();
  });

  it('succeeds and updates stock when the item genuinely exists', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: ITEM_ID }])
      .mockResolvedValueOnce([{ quantity: 20 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ item_id: ITEM_ID, quantity: 30 }]);

    const result = await InventoryService.recordMovement(TENANT_ID, USER_ID, {
      itemId: ITEM_ID,
      type: 'receive',
      quantity: 10,
    });

    expect(result.quantity).toBe(30);
  });

  it('still enforces insufficient-stock protection', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: ITEM_ID }])
      .mockResolvedValueOnce([{ quantity: 5 }]);

    await expect(
      InventoryService.recordMovement(TENANT_ID, USER_ID, {
        itemId: ITEM_ID,
        type: 'ship',
        quantity: 100,
      })
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe('regression guard', () => {
  it('setupMockItem no longer exists on InventoryService', () => {
    expect((InventoryService as any).setupMockItem).toBeUndefined();
  });
});
