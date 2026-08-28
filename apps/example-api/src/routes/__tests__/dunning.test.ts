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
import { dunningRouter } from '../dunning';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const INVOICE_ID = '55555555-5555-5555-5555-555555555555';
const SEQ_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', dunningRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('dunning routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items starts a sequence at stage 1 and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SEQ_ID, customer_id: CUSTOMER_ID, invoice_id: INVOICE_ID, stage: 1, status: 'active', last_sent_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ customerId: CUSTOMER_ID, invoiceId: INVOICE_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.stage).toBe(1);
    expect(res.body.data.status).toBe('active');
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ customerId: 'not-a-uuid' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only active sequences, tenant-wide with no user_id filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SEQ_ID, customer_id: CUSTOMER_ID, invoice_id: INVOICE_ID, stage: 2, status: 'active', last_sent_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(SEQ_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`WHERE status = 'active'`);
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id cancels a sequence via a two-value state guard (active or paused), no ownership check', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SEQ_ID }]);

    const res = await request(buildApp()).delete(`/items/${SEQ_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SEQ_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'cancelled'`);
    expect(sql).toContain(`AND status IN ('active', 'paused')`);
    expect(params).toEqual([SEQ_ID]);
  });

  it('DELETE /items/:id returns 404 when sequence not found or already resolved/cancelled', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SEQ_ID}`);

    expect(res.status).toBe(404);
  });
});
