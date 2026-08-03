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
import { rpaRouter } from '../rpa';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', rpaRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('rpa routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a task with 1+ steps and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: TASK_ID, name: 'Nightly invoice pull', target_app: 'legacy_erp', steps: [{ action: 'login' }, { action: 'download_report' }], enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Nightly invoice pull', targetApp: 'legacy_erp', steps: [{ action: 'login' }, { action: 'download_report' }] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Nightly invoice pull');
    expect(res.body.data.id).toBe(TASK_ID);
  });

  it('POST /items returns 422 when steps array is empty', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad task', targetApp: 'legacy_erp', steps: [] });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '', targetApp: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated tasks scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: TASK_ID, name: 'Nightly invoice pull', target_app: 'legacy_erp', steps: [], enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(TASK_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a task owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: TASK_ID }]);

    const res = await request(buildApp()).delete(`/items/${TASK_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TASK_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([TASK_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when task not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${TASK_ID}`);

    expect(res.status).toBe(404);
  });
});
