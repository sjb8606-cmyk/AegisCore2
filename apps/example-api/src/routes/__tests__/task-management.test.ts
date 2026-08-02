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
import { taskManagementRouter } from '../task-management';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';
const TASK_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', taskManagementRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('task-management routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a task and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: TASK_ID, user_id: USER_ID, assignee_id: null, title: 'Write report', description: null, status: 'open', due_date: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ title: 'Write report' });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Write report');
    expect(res.body.data.id).toBe(TASK_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ title: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns tasks I created OR am assigned to, using the same userId in both branches', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: TASK_ID, user_id: OTHER_USER_ID, assignee_id: USER_ID, title: 'Review PR', description: null, status: 'open', due_date: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(TASK_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('user_id = $1 OR assignee_id = $1');
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a task created by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: TASK_ID }]);

    const res = await request(buildApp()).delete(`/items/${TASK_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TASK_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([TASK_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when task is only assigned to (not created by) the requesting user', async () => {
    // being the assignee is not enough to delete — only the creator can
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${TASK_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not created by you/);
  });
});
