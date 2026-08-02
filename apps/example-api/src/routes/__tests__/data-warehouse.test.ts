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
import { dataWarehouseRouter } from '../data-warehouse';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', dataWarehouseRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('data-warehouse routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items queues a sync job and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: JOB_ID, destination: 'snowflake', status: 'queued', rows_synced: '0', created_at: new Date().toISOString(), completed_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ destination: 'snowflake' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.id).toBe(JOB_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ destination: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated jobs scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: JOB_ID, destination: 'snowflake', status: 'running', rows_synced: '1200', created_at: new Date().toISOString(), completed_at: null },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(JOB_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id cancels a job via a state guard requiring status = queued exactly', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: JOB_ID }]);

    const res = await request(buildApp()).delete(`/items/${JOB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(JOB_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'failed'`);
    expect(sql).toContain(`AND status = 'queued'`);
    expect(params).toEqual([JOB_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when job not found, not owned, or already running/completed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${JOB_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/already running\/completed/);
  });
});
