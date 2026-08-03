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
import { customReportsRouter } from '../custom-reports';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REPORT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', customReportsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('custom-reports routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a report and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REPORT_ID, name: 'Monthly Revenue', query_definition: { metric: 'revenue', groupBy: 'month' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Monthly Revenue', queryDefinition: { metric: 'revenue', groupBy: 'month' } });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Monthly Revenue');
    expect(res.body.data.id).toBe(REPORT_ID);
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

  it('GET /items returns paginated reports scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REPORT_ID, name: 'Monthly Revenue', query_definition: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(REPORT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a report owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: REPORT_ID }]);

    const res = await request(buildApp()).delete(`/items/${REPORT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(REPORT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([REPORT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when report not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${REPORT_ID}`);

    expect(res.status).toBe(404);
  });
});
