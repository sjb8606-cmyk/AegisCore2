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
import { etlPipelineRouter } from '../etl-pipeline';

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
  app.use('/', etlPipelineRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('etl-pipeline routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a job with a valid schedule and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: JOB_ID, name: 'Nightly sync', source: 'postgres:orders', destination: 's3:warehouse', schedule_cron: '0 2 * * *', status: 'idle', last_run_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Nightly sync', source: 'postgres:orders', destination: 's3:warehouse', scheduleCron: '0 2 * * *' });

    expect(res.status).toBe(201);
    expect(res.body.data.schedule_cron).toBe('0 2 * * *');
  });

  it('POST /items allows omitting scheduleCron entirely (manually triggered job)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: JOB_ID, name: 'Manual backfill', source: 'postgres:orders', destination: 's3:warehouse', schedule_cron: null, status: 'idle', last_run_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Manual backfill', source: 'postgres:orders', destination: 's3:warehouse' });

    expect(res.status).toBe(201);
    expect(res.body.data.schedule_cron).toBeNull();
  });

  it('POST /items returns 422 on a malformed scheduleCron', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad job', source: 'x', destination: 'y', scheduleCron: 'not a cron string' });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '' });

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
      { id: JOB_ID, name: 'Nightly sync', source: 'postgres:orders', destination: 's3:warehouse', schedule_cron: '0 2 * * *', status: 'idle', last_run_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(JOB_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a job owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: JOB_ID }]);

    const res = await request(buildApp()).delete(`/items/${JOB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(JOB_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([JOB_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when job not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${JOB_ID}`);

    expect(res.status).toBe(404);
  });
});
