import express from 'express';
import request from 'supertest';

jest.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: jest.fn(),
}));
jest.mock('../../../../../platform/audit/src/index', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: jest.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { productCatalogRouter } from '../product-catalog';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', productCatalogRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('product-catalog routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items upserts a product via ON CONFLICT (tenant_id, sku), wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PRODUCT_ID, sku: 'WIDGET-001', name: 'Blue Widget', description: null, price_cents: 1999, currency: 'USD', active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ sku: 'WIDGET-001', name: 'Blue Widget', priceCents: 1999 });

    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('WIDGET-001');
    expect(res.body.data.price_cents).toBe(1999);
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, sku)');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('POST /items returns 422 on invalid body (negative price)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ sku: 'X', name: 'Bad Product', priceCents: -100 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only active products, tenant-wide with no user_id filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PRODUCT_ID, sku: 'WIDGET-001', name: 'Blue Widget', description: null, price_cents: 1999, currency: 'USD', active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(PRODUCT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE active = true');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id deactivates a product with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: PRODUCT_ID }]);

    const res = await request(buildApp()).delete(`/items/${PRODUCT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(PRODUCT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET active = false');
    expect(params).toEqual([PRODUCT_ID]);
  });

  it('DELETE /items/:id returns 404 when product not found or already inactive', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${PRODUCT_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/already inactive/);
  });
});
