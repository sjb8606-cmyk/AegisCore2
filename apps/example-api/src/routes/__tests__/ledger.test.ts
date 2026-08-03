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
import { ledgerRouter } from '../ledger';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ENTRY_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', ledgerRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('ledger routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has no DELETE /items/:id route (ledger is append-only)', async () => {
    const res = await request(buildApp()).delete(`/items/${ENTRY_ID}`);

    expect(res.status).toBe(404);
  });

  it('POST /items records a debit entry and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ENTRY_ID, user_id: USER_ID, entry_type: 'debit', amount_cents: 5000, currency: 'USD', description: 'Office supplies', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ account: 'expenses:office', entryType: 'debit', amountCents: 5000, description: 'Office supplies' });

    expect(res.status).toBe(201);
    expect(res.body.data.entry_type).toBe('debit');
    expect(res.body.data.id).toBe(ENTRY_ID);
  });

  it('POST /items returns 422 on invalid body (non-positive amount)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ account: 'expenses:office', entryType: 'debit', amountCents: -100 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when account query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ account: 'expenses:office', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns entries for the given account, tenant-wide (no user_id filter)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ENTRY_ID, user_id: USER_ID, entry_type: 'credit', amount_cents: 5000, currency: 'USD', description: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ account: 'expenses:office' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ENTRY_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe('expenses:office');
    expect(params).not.toContain(USER_ID);
  });
});
