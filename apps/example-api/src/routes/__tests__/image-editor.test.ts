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
import { imageEditorRouter } from '../image-editor';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRESET_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', imageEditorRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('image-editor routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a preset with 1+ operations and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PRESET_ID, name: 'Product photo cleanup', operations: [{ op: 'crop', params: {} }, { op: 'sharpen', params: { amount: 0.5 } }], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Product photo cleanup', operations: [{ op: 'crop' }, { op: 'sharpen', params: { amount: 0.5 } }] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Product photo cleanup');
    expect(res.body.data.id).toBe(PRESET_ID);
  });

  it('POST /items returns 422 when operations array is empty', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Bad preset', operations: [] });

    expect(res.status).toBe(422);
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

  it('GET /items returns paginated presets scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PRESET_ID, name: 'Product photo cleanup', operations: [], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(PRESET_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a preset owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: PRESET_ID }]);

    const res = await request(buildApp()).delete(`/items/${PRESET_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(PRESET_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([PRESET_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when preset not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${PRESET_ID}`);

    expect(res.status).toBe(404);
  });
});
