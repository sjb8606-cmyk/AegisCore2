import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { digitalProductsRouter } from '../digital-products';

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
  app.use('/', digitalProductsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('digital-products routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a product with a valid fileUrl and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PRODUCT_ID, name: 'E-book', file_url: 'https://cdn.example.com/ebook.pdf', price_cents: 999, download_limit: 3, active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'E-book', fileUrl: 'https://cdn.example.com/ebook.pdf', priceCents: 999, downloadLimit: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('E-book');
    expect(res.body.data.id).toBe(PRODUCT_ID);
  });

  it('POST /items returns 422 on an invalid fileUrl', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'E-book', fileUrl: 'not-a-url', priceCents: 999 });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '', priceCents: -1 });

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
      { id: PRODUCT_ID, name: 'E-book', file_url: 'https://cdn.example.com/ebook.pdf', price_cents: 999, download_limit: null, active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(PRODUCT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE active = true');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id deactivates a product owned by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: PRODUCT_ID }]);

    const res = await request(buildApp()).delete(`/items/${PRODUCT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(PRODUCT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET active = false');
    expect(params).toEqual([PRODUCT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when product not found, not owned, or already inactive', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${PRODUCT_ID}`);

    expect(res.status).toBe(404);
  });
});
