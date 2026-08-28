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
import { bundlesRouter } from '../bundles';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_A = '44444444-4444-4444-4444-444444444444';
const PRODUCT_B = '55555555-5555-5555-5555-555555555555';
const BUNDLE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', bundlesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('bundles routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a bundle with 2+ products and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: BUNDLE_ID, name: 'Starter Pack', product_ids: [PRODUCT_A, PRODUCT_B], bundle_price_cents: 4999, active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Starter Pack', productIds: [PRODUCT_A, PRODUCT_B], bundlePriceCents: 4999 });

    expect(res.status).toBe(201);
    expect(res.body.data.product_ids).toEqual([PRODUCT_A, PRODUCT_B]);
    expect(res.body.data.id).toBe(BUNDLE_ID);
  });

  it('POST /items returns 422 when fewer than 2 products are given', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad bundle', productIds: [PRODUCT_A], bundlePriceCents: 999 });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body (negative price)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad bundle', productIds: [PRODUCT_A, PRODUCT_B], bundlePriceCents: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only active bundles, tenant-wide with no user_id filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: BUNDLE_ID, name: 'Starter Pack', product_ids: [PRODUCT_A, PRODUCT_B], bundle_price_cents: 4999, active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(BUNDLE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE active = true');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id deactivates a bundle with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: BUNDLE_ID }]);

    const res = await request(buildApp()).delete(`/items/${BUNDLE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(BUNDLE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET active = false');
    expect(params).toEqual([BUNDLE_ID]);
  });

  it('DELETE /items/:id returns 404 when bundle not found or already inactive', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${BUNDLE_ID}`);

    expect(res.status).toBe(404);
  });
});
