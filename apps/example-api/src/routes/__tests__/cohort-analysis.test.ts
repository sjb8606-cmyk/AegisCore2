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
import { cohortAnalysisRouter } from '../cohort-analysis';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const COHORT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', cohortAnalysisRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('cohort-analysis routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a cohort and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: COHORT_ID, name: 'Power users', criteria: { minLogins: 30 }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Power users', criteria: { minLogins: 30 } });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Power users');
    expect(res.body.data.id).toBe(COHORT_ID);
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

  it('GET /items returns paginated cohorts scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: COHORT_ID, name: 'Power users', criteria: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(COHORT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a cohort owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: COHORT_ID }]);

    const res = await request(buildApp()).delete(`/items/${COHORT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(COHORT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([COHORT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when cohort not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${COHORT_ID}`);

    expect(res.status).toBe(404);
  });
});
