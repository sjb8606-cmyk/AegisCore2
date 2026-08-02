import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn(),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { cartRouter } from '../cart';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/cart', cartRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /cart/items', () => {
  it('adds a real cart item with integer cents pricing', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ITEM_ID, product_id: PRODUCT_ID, product_name: 'Widget', quantity: 2, unit_price_cents: 1999, created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .post('/cart/items')
      .send({ productId: PRODUCT_ID, productName: 'Widget', quantity: 2, unitPriceCents: 1999 });

    expect(res.status).toBe(201);
    expect(res.body.data.unit_price_cents).toBe(1999);
  });

  it('upserts (updates quantity) when the same product is added again — real ON CONFLICT, not a duplicate row', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: ITEM_ID, product_id: PRODUCT_ID, product_name: 'Widget', quantity: 5, unit_price_cents: 1999, created_at: '2026-08-01T00:00:00Z' },
    ]);

    const res = await request(buildTestApp())
      .post('/cart/items')
      .send({ productId: PRODUCT_ID, productName: 'Widget', quantity: 5, unitPriceCents: 1999 });

    expect(res.status).toBe(201);
    expect(res.body.data.quantity).toBe(5);
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('ON CONFLICT');
    expect(call[0]).toContain('DO UPDATE SET quantity');
  });

  it('rejects a non-integer / negative price with a real 422', async () => {
    const res = await request(buildTestApp())
      .post('/cart/items')
      .send({ productId: PRODUCT_ID, productName: 'Widget', quantity: 1, unitPriceCents: -5 });

    expect(res.status).toBe(422);
  });

  it('rejects a zero or negative quantity with a real 422', async () => {
    const res = await request(buildTestApp())
      .post('/cart/items')
      .send({ productId: PRODUCT_ID, productName: 'Widget', quantity: 0, unitPriceCents: 1999 });

    expect(res.status).toBe(422);
  });
});

describe('GET /cart/items', () => {
  it('lists real cart items scoped to the calling user', async () => {
    (withTenantQuery as any).mockResolvedValue([]);
    await request(buildTestApp()).get('/cart/items');

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[1][0]).toBe(USER_ID);
  });
});

describe('DELETE /cart/items/:id', () => {
  it('removes a real cart item owned by the caller', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: ITEM_ID }]);

    const res = await request(buildTestApp()).delete(`/cart/items/${ITEM_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ITEM_ID);
  });

  it('returns 404 for an item that does not belong to the caller', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp()).delete(`/cart/items/${ITEM_ID}`);
    expect(res.status).toBe(404);
  });
});
