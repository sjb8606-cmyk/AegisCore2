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
import { permissionsAdvancedRouter } from '../permissions-advanced';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const GRANTEE_ID = '44444444-4444-4444-4444-444444444444';
const GRANT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', permissionsAdvancedRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('permissions-advanced routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a grant and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: GRANT_ID, granted_by: USER_ID, grantee_id: GRANTEE_ID, resource_type: 'document', resource_id: null, permission: 'read', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ granteeId: GRANTEE_ID, resourceType: 'document', permission: 'read' });

    expect(res.status).toBe(201);
    expect(res.body.data.permission).toBe('read');
    expect(res.body.data.id).toBe(GRANT_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ granteeId: 'not-a-uuid', resourceType: '', permission: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only non-revoked grants, tenant-wide (no user filter)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: GRANT_ID, granted_by: USER_ID, grantee_id: GRANTEE_ID, resource_type: 'document', resource_id: null, permission: 'read', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(GRANT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE revoked_at IS NULL');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id revokes a grant created by the requesting user (granted_by match)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: GRANT_ID }]);

    const res = await request(buildApp()).delete(`/items/${GRANT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(GRANT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('AND granted_by = $2');
    expect(sql).toContain('AND revoked_at IS NULL');
    expect(params).toEqual([GRANT_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when grant not found, already revoked, or granted by someone else', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${GRANT_ID}`);

    expect(res.status).toBe(404);
  });
});
