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
import { mediaLibraryRouter } from '../media-library';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ASSET_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', mediaLibraryRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('media-library routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items adds an asset with a valid fileUrl and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ASSET_ID, file_url: 'https://cdn.example.com/logo.png', file_type: 'image/png', file_size_bytes: '20480', tags: ['branding'], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ fileUrl: 'https://cdn.example.com/logo.png', fileType: 'image/png', fileSizeBytes: 20480, tags: ['branding'] });

    expect(res.status).toBe(201);
    expect(res.body.data.file_type).toBe('image/png');
    expect(res.body.data.id).toBe(ASSET_ID);
  });

  it('POST /items returns 422 on an invalid fileUrl', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ fileUrl: 'not-a-url', fileType: 'image/png' });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ fileType: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated assets scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ASSET_ID, file_url: 'https://cdn.example.com/logo.png', file_type: 'image/png', file_size_bytes: null, tags: [], created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ASSET_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes an asset owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: ASSET_ID }]);

    const res = await request(buildApp()).delete(`/items/${ASSET_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ASSET_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([ASSET_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when asset not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${ASSET_ID}`);

    expect(res.status).toBe(404);
  });
});
