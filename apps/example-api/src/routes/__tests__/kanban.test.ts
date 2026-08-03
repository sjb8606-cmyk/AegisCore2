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
import { kanbanRouter } from '../kanban';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CARD_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', kanbanRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('kanban routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a card and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: CARD_ID, column_name: 'todo', title: 'Fix login bug', position: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ boardName: 'Sprint 12', title: 'Fix login bug' });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Fix login bug');
    expect(res.body.data.id).toBe(CARD_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ title: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when boardName query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ boardName: 'Sprint 12', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns cards for the given board, tenant-wide (no user_id filter)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: CARD_ID, column_name: 'in_progress', title: 'Fix login bug', position: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ boardName: 'Sprint 12' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(CARD_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe('Sprint 12');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes a card created by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: CARD_ID }]);

    const res = await request(buildApp()).delete(`/items/${CARD_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(CARD_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([CARD_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when card not found or not created by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${CARD_ID}`);

    expect(res.status).toBe(404);
  });
});
