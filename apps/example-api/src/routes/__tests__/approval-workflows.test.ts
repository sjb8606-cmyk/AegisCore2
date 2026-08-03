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
import { approvalWorkflowsRouter } from '../approval-workflows';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', approvalWorkflowsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('approval-workflows routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items submits a request and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REQUEST_ID, request_type: 'expense_report', payload: { amountCents: 5000 }, status: 'pending', approver_id: null, created_at: new Date().toISOString(), resolved_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ requestType: 'expense_report', payload: { amountCents: 5000 } });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.id).toBe(REQUEST_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ requestType: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated requests scoped to the requester', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REQUEST_ID, request_type: 'expense_report', payload: {}, status: 'pending', approver_id: null, created_at: new Date().toISOString(), resolved_at: null },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(REQUEST_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE requester_id = $1');
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id withdraws a pending request via a status-guarded query', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: REQUEST_ID }]);

    const res = await request(buildApp()).delete(`/items/${REQUEST_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(REQUEST_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('AND requester_id = $2');
    expect(sql).toContain(`AND status = 'pending'`);
    expect(params).toEqual([REQUEST_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when request not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${REQUEST_ID}`);

    expect(res.status).toBe(404);
  });

  it('DELETE /items/:id returns 404 when request already approved or rejected (no longer pending)', async () => {
    // the status = 'pending' guard means a resolved request returns zero
    // rows, same as a not-found or not-owned request
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${REQUEST_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer pending/);
  });
});
