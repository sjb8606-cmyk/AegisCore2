import express from 'express';
import request from 'supertest';

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
import { sessionManagementRouter } from '../session-management';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', sessionManagementRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('session-management routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no POST /items route (sessions are created only by the login flow)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ deviceInfo: 'iPhone' });

    expect(res.status).toBe(404);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only my active, non-revoked sessions', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SESSION_ID, device_info: 'Chrome on macOS', ip_address: '1.2.3.4', last_active_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(SESSION_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id revokes a session via UPDATE, not a hard delete', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SESSION_ID }]);

    const res = await request(buildApp()).delete(`/items/${SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SESSION_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('UPDATE active_sessions');
    expect(sql).toContain('SET revoked_at = NOW()');
    expect(params).toEqual([SESSION_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when session not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SESSION_ID}`);

    expect(res.status).toBe(404);
  });

  it('DELETE /items/:id returns 404 when the session is already revoked', async () => {
    // the WHERE revoked_at IS NULL clause means an already-revoked session
    // returns zero rows, same as a not-found session
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SESSION_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/already revoked/);
  });
});
