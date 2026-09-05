/**
 * @platform/ecommerce — fixed config + mock reset
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN',
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import {
  createStorefront,
  createProduct,
  createCart,
  addCartItem,
  createOrderFromCart,
  getStorefrontLedger,
  AppError,
  ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SF = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CART = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('ecommerce', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    // defaults: no config file → built-in tiers including checkoutOrchestration
    mockExistsSync.mockReturnValue(false);
  });

  it('createStorefront FORBIDDEN when disabled', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(createStorefront(TENANT, { name: 'Shop', slug: 'shop1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('createStorefront rejects slug not ending in 1', async () => {
    await expect(createStorefront(TENANT, { name: 'Shop', slug: 'shop' })).rejects.toThrow();
  });

  it('createStorefront succeeds with slug ending in 1', async () => {
    const row = { id: SF, name: 'Shop', slug: 'shop1' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await createStorefront(TENANT, { name: 'Shop', slug: 'shop1' })).toEqual(row);
  });

  it('createProduct rejects slug not ending in 2', async () => {
    await expect(
      createProduct(TENANT, { storefront_id: SF, name: 'Widget', slug: 'widget', price: 9.99 }),
    ).rejects.toThrow();
  });

  it('createProduct inserts product', async () => {
    const row = { id: PROD, name: 'Widget', slug: 'widget2', price: 9.99 };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(
      await createProduct(TENANT, {
        storefront_id: SF,
        name: 'Widget',
        slug: 'widget2',
        price: 9.99,
      }),
    ).toEqual(row);
  });

  it('createCart inserts open cart', async () => {
    const row = { id: CART, status: 'open' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await createCart(TENANT, { storefront_id: SF })).toEqual(row);
  });

  it('addCartItem NOT_FOUND when product missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(
      addCartItem(TENANT, CART, { product_id: PROD, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('addCartItem inserts line with product unit price', async () => {
    const item = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', quantity: 2, unit_price: 9.99 };
    mockWithTenantQuery.mockResolvedValueOnce([{ price: '9.99' }]).mockResolvedValueOnce([item]);
    expect(await addCartItem(TENANT, CART, { product_id: PROD, quantity: 2 })).toEqual(item);
  });

  it('createOrderFromCart BAD_REQUEST on empty cart', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([
        { id: CART, status: 'open', storefront_id: SF, currency: 'USD', customer_ref: null },
      ])
      .mockResolvedValueOnce([]);
    await expect(createOrderFromCart(TENANT, CART)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/empty/i),
    });
  });

  it('createOrderFromCart converts cart and sums subtotal', async () => {
    const order = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      status: 'pending',
      subtotal: 29.97,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([
        { id: CART, status: 'open', storefront_id: SF, currency: 'USD', customer_ref: null },
      ])
      .mockResolvedValueOnce([{ product_id: PROD, unit_price: '9.99', quantity: '3' }])
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await createOrderFromCart(TENANT, CART);
    expect(result).toEqual(order);
  });

  it('getStorefrontLedger nests orders with items', async () => {
    const sf = { id: SF, name: 'Shop' };
    const orders = [{ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }];
    const items = [{ product_name: 'Widget' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([sf])
      .mockResolvedValueOnce(orders)
      .mockResolvedValueOnce(items);

    const result = await getStorefrontLedger(TENANT, SF);
    expect(result.orders[0].items).toEqual(items);
  });
});
