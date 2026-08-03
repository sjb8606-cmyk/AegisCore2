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
import { dataPipelinesRouter } from '../data-pipelines';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PIPELINE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', dataPipelinesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('data-pipelines routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a pipeline and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PIPELINE_ID, name: 'Orders sync', source: 'postgres:orders', destination: 's3:warehouse', transform: {}, enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Orders sync', source: 'postgres:orders', destination: 's3:warehouse' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Orders sync');
    expect(res.body.data.id).toBe(PIPELINE_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '', source: '', destination: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated pipelines scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PIPELINE_ID, name: 'Orders sync', source: 'postgres:orders', destination: 's3:warehouse', transform: {}, enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(PIPELINE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a pipeline owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: PIPELINE_ID }]);

    const res = await request(buildApp()).delete(`/items/${PIPELINE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(PIPELINE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([PIPELINE_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when pipeline not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${PIPELINE_ID}`);

    expect(res.status).toBe(404);
  });
});
