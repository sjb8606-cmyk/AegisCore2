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
import { teamChatRouter } from '../team-chat';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';
const MESSAGE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', teamChatRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('team-chat routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items posts a message and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: MESSAGE_ID, user_id: USER_ID, body: 'hey team', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ channel: 'general', body: 'hey team' });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('hey team');
    expect(res.body.data.id).toBe(MESSAGE_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ channel: '', body: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when channel query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ channel: 'general', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns non-deleted messages for the channel, tenant-wide (no user_id filter)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: MESSAGE_ID, user_id: OTHER_USER_ID, body: 'hey team', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ channel: 'general' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(MESSAGE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
    expect(params[0]).toBe('general');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id soft-deletes a message authored by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: MESSAGE_ID }]);

    const res = await request(buildApp()).delete(`/items/${MESSAGE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(MESSAGE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET deleted_at = NOW()');
    expect(sql).toContain('AND deleted_at IS NULL');
    expect(params).toEqual([MESSAGE_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when message not found, not owned, or already deleted', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${MESSAGE_ID}`);

    expect(res.status).toBe(404);
  });
});
