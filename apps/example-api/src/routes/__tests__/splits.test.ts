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
import { splitsRouter } from '../splits';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RECIPIENT_A = '44444444-4444-4444-4444-444444444444';
const RECIPIENT_B = '55555555-5555-5555-5555-555555555555';
const SPLIT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', splitsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('splits routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a split when recipient shares sum to 100', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SPLIT_ID, name: 'Co-author split', recipients: [{ recipientId: RECIPIENT_A, sharePercent: 60 }, { recipientId: RECIPIENT_B, sharePercent: 40 }], active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Co-author split', recipients: [{ recipientId: RECIPIENT_A, sharePercent: 60 }, { recipientId: RECIPIENT_B, sharePercent: 40 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Co-author split');
    expect(res.body.data.id).toBe(SPLIT_ID);
  });

  it('POST /items returns 422 when recipient shares do not sum to 100', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad split', recipients: [{ recipientId: RECIPIENT_A, sharePercent: 60 }, { recipientId: RECIPIENT_B, sharePercent: 30 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/must sum to 100/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on invalid body (empty recipients)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad split', recipients: [] });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated splits scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SPLIT_ID, name: 'Co-author split', recipients: [], active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(SPLIT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id deactivates a split owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SPLIT_ID }]);

    const res = await request(buildApp()).delete(`/items/${SPLIT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SPLIT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET active = false');
    expect(params).toEqual([SPLIT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when split not found, not owned, or already inactive', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SPLIT_ID}`);

    expect(res.status).toBe(404);
  });
});
