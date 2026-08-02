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
import { gdprToolsRouter } from '../gdpr-tools';

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
  app.use('/', gdprToolsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('gdpr-tools routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items submits a valid-enum request and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REQUEST_ID, request_type: 'deletion', status: 'pending', notes: null, created_at: new Date().toISOString(), completed_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ requestType: 'deletion' });

    expect(res.status).toBe(201);
    expect(res.body.data.request_type).toBe('deletion');
    expect(res.body.data.status).toBe('pending');
  });

  it('POST /items returns 422 on an invalid requestType (not one of the 4 allowed values)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ requestType: 'export_everything' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated requests scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REQUEST_ID, request_type: 'access', status: 'pending', notes: null, created_at: new Date().toISOString(), completed_at: null },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(REQUEST_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id withdraws a pending request via a status-guarded query requiring status = pending exactly', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: REQUEST_ID }]);

    const res = await request(buildApp()).delete(`/items/${REQUEST_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(REQUEST_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'rejected'`);
    expect(sql).toContain(`AND status = 'pending'`);
    expect(params).toEqual([REQUEST_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when request not found, not owned, or already past pending', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${REQUEST_ID}`);

    expect(res.status).toBe(404);
  });
});
