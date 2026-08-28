import express from 'express';
import request from 'supertest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { productVariantsRouter } from '../product-variants';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '44444444-4444-4444-4444-444444444444';
const VARIANT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', productVariantsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('product-variants routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items upserts a variant via ON CONFLICT (tenant_id, product_id, sku_suffix)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: VARIANT_ID, sku_suffix: 'RED-L', attributes: { color: 'red', size: 'L' }, price_cents: 2999, stock_count: 10, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ productId: PRODUCT_ID, skuSuffix: 'RED-L', attributes: { color: 'red', size: 'L' }, priceCents: 2999, stockCount: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.sku_suffix).toBe('RED-L');
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, product_id, sku_suffix)');
  });

  it('POST /items returns 422 on invalid body (negative price)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ productId: PRODUCT_ID, skuSuffix: 'X', priceCents: -100 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when productId query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ productId: PRODUCT_ID, limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns variants for the given product, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: VARIANT_ID, sku_suffix: 'RED-L', attributes: {}, price_cents: 2999, stock_count: 10, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ productId: PRODUCT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(VARIANT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(PRODUCT_ID);
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes a variant with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: VARIANT_ID }]);

    const res = await request(buildApp()).delete(`/items/${VARIANT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VARIANT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([VARIANT_ID]);
  });

  it('DELETE /items/:id returns 404 when variant not found', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${VARIANT_ID}`);

    expect(res.status).toBe(404);
  });
});
