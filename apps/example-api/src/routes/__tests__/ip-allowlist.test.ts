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
import { ipAllowlistRouter } from '../ip-allowlist';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ENTRY_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', ipAllowlistRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('ip-allowlist routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items adds a valid CIDR entry via upsert, wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ENTRY_ID, ip_cidr: '203.0.113.0/24', description: 'Office VPN', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ ipCidr: '203.0.113.0/24', description: 'Office VPN' });

    expect(res.status).toBe(201);
    expect(res.body.data.ip_cidr).toBe('203.0.113.0/24');
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, ip_cidr)');
  });

  it('POST /items returns 422 on a malformed CIDR', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ ipCidr: 'not-a-cidr' });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body (missing ipCidr)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ description: 'no cidr' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns entries tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ENTRY_ID, ip_cidr: '203.0.113.0/24', description: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ENTRY_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes an entry with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: ENTRY_ID }]);

    const res = await request(buildApp()).delete(`/items/${ENTRY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ENTRY_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([ENTRY_ID]);
  });

  it('DELETE /items/:id returns 404 when entry not found', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${ENTRY_ID}`);

    expect(res.status).toBe(404);
  });
});
