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
import { sharedWorkspacesRouter } from '../shared-workspaces';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', sharedWorkspacesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('shared-workspaces routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a workspace and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: WORKSPACE_ID, user_id: USER_ID, name: 'Marketing team', description: null, member_ids: [], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Marketing team' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Marketing team');
    expect(res.body.data.id).toBe(WORKSPACE_ID);
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

  it('GET /items returns workspaces tenant-wide, not scoped to the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: WORKSPACE_ID, user_id: OTHER_USER_ID, name: 'Someone else\'s workspace', description: null, member_ids: [], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].user_id).toBe(OTHER_USER_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes a workspace created by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: WORKSPACE_ID }]);

    const res = await request(buildApp()).delete(`/items/${WORKSPACE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(WORKSPACE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([WORKSPACE_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when workspace not found or created by someone else', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${WORKSPACE_ID}`);

    expect(res.status).toBe(404);
  });
});
