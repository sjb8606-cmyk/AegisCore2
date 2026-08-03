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
import { ganttRouter } from '../gantt';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', ganttRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('gantt routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates an item with a valid date range and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ITEM_ID, title: 'Design phase', start_date: '2026-01-01', end_date: '2026-01-15', progress_pct: 0, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ projectName: 'Website relaunch', title: 'Design phase', startDate: '2026-01-01', endDate: '2026-01-15' });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Design phase');
    expect(res.body.data.id).toBe(ITEM_ID);
  });

  it('POST /items returns 422 when endDate is before startDate (manual business check)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ projectName: 'Website relaunch', title: 'Bad item', startDate: '2026-02-01', endDate: '2026-01-01' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/endDate must not be before startDate/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ projectName: '', title: '', startDate: 'not-a-date', endDate: 'not-a-date' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when projectName query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ projectName: 'Website relaunch', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns items for the given project, tenant-wide (no user_id filter)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ITEM_ID, title: 'Design phase', start_date: '2026-01-01', end_date: '2026-01-15', progress_pct: 40, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ projectName: 'Website relaunch' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ITEM_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe('Website relaunch');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes an item created by the requesting user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: ITEM_ID }]);

    const res = await request(buildApp()).delete(`/items/${ITEM_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ITEM_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([ITEM_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when item not found or not created by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${ITEM_ID}`);

    expect(res.status).toBe(404);
  });
});
