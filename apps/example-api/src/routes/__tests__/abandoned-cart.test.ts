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
import { abandonedCartRouter } from '../abandoned-cart';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CART_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', abandonedCartRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('abandoned-cart routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items records an abandoned cart and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: CART_ID, cart_snapshot: [{ sku: 'WIDGET-001', qty: 2 }], total_cents: 5998, recovery_sent_at: null, recovered_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ cartSnapshot: [{ sku: 'WIDGET-001', qty: 2 }], totalCents: 5998 });

    expect(res.status).toBe(201);
    expect(res.body.data.total_cents).toBe(5998);
    expect(res.body.data.id).toBe(CART_ID);
  });

  it('POST /items returns 422 on an empty cartSnapshot', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ cartSnapshot: [], totalCents: 1000 });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ totalCents: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated carts scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: CART_ID, cart_snapshot: [], total_cents: 5998, recovery_sent_at: null, recovered_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(CART_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id marks a cart recovered via UPDATE, not a hard delete', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: CART_ID }]);

    const res = await request(buildApp()).delete(`/items/${CART_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(CART_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET recovered_at = NOW()');
    expect(sql).toContain('AND recovered_at IS NULL');
    expect(params).toEqual([CART_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when cart not found, not owned, or already recovered', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${CART_ID}`);

    expect(res.status).toBe(404);
  });
});
