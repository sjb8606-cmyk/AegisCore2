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
import { cronJobsRouter } from '../cron-jobs';

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
  app.use('/', cronJobsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('cron-jobs routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a job with a valid cron expression and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: JOB_ID, name: 'Nightly cleanup', cron_expression: '0 2 * * *', job_type: 'cleanup', payload: {}, enabled: true, last_run_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Nightly cleanup', cronExpression: '0 2 * * *', jobType: 'cleanup' });

    expect(res.status).toBe(201);
    expect(res.body.data.cron_expression).toBe('0 2 * * *');
    expect(res.body.data.id).toBe(JOB_ID);
  });

  it('POST /items returns 422 on a malformed cron expression', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad job', cronExpression: 'not a cron string', jobType: 'cleanup' });

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
      { id: JOB_ID, name: 'Nightly cleanup', cron_expression: '0 2 * * *', job_type: 'cleanup', payload: {}, enabled: true, last_run_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
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
