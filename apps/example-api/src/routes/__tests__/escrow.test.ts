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
import { escrowRouter } from '../escrow';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const COUNTERPARTY_ID = '44444444-4444-4444-4444-444444444444';
const ESCROW_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', escrowRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('escrow routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items opens an escrow at status held and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ESCROW_ID, counterparty_id: COUNTERPARTY_ID, amount_cents: '50000', currency: 'USD', status: 'held', created_at: new Date().toISOString(), resolved_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ counterpartyId: COUNTERPARTY_ID, amountCents: 50000 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('held');
    expect(res.body.data.id).toBe(ESCROW_ID);
  });

  it('POST /items returns 422 on invalid body (non-positive amount)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ counterpartyId: COUNTERPARTY_ID, amountCents: -100 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated escrow accounts scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ESCROW_ID, counterparty_id: COUNTERPARTY_ID, amount_cents: '50000', currency: 'USD', status: 'held', created_at: new Date().toISOString(), resolved_at: null },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ESCROW_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id releases held funds via a state guard requiring status = held exactly', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: ESCROW_ID }]);

    const res = await request(buildApp()).delete(`/items/${ESCROW_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ESCROW_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'released', resolved_at = NOW()`);
    expect(sql).toContain(`AND status = 'held'`);
    expect(params).toEqual([ESCROW_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when escrow not found, not owned, or already resolved (released/refunded/disputed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${ESCROW_ID}`);

    expect(res.status).toBe(404);
  });
});
