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
import { reconciliationRouter } from '../reconciliation';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RECORD_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', reconciliationRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('reconciliation routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a record and never sends discrepancy_cents to the DB (generated column)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RECORD_ID, statement_total_cents: '10000', ledger_total_cents: '9800', discrepancy_cents: '200', status: 'open', notes: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ account: 'checking-001', statementTotalCents: 10000, ledgerTotalCents: 9800 });

    expect(res.status).toBe(201);
    expect(res.body.data.discrepancy_cents).toBe('200');
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([TENANT_ID, USER_ID, 'checking-001', 10000, 9800, null]);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ account: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when account query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ account: 'checking-001', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns records for the given account, scoped to the user via WHERE not shown as user_id filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RECORD_ID, statement_total_cents: '10000', ledger_total_cents: '10000', discrepancy_cents: '0', status: 'open', notes: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ account: 'checking-001' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(RECORD_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe('checking-001');
  });

  it('DELETE /items/:id resolves a record via a state guard requiring status = open exactly', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: RECORD_ID }]);

    const res = await request(buildApp()).delete(`/items/${RECORD_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(RECORD_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'resolved', resolved_at = NOW()`);
    expect(sql).toContain(`AND status = 'open'`);
    expect(params).toEqual([RECORD_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when record not found, not owned, or already resolved', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${RECORD_ID}`);

    expect(res.status).toBe(404);
  });
});
