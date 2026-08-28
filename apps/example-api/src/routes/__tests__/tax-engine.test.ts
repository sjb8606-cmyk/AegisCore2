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
import { taxEngineRouter } from '../tax-engine';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RULE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', taxEngineRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('tax-engine routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items upserts a rule via ON CONFLICT and reactivates it (active = true)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RULE_ID, jurisdiction: 'CA', rate_percent: '7.25', applies_to: 'all', active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ jurisdiction: 'CA', ratePercent: 7.25 });

    expect(res.status).toBe(201);
    expect(res.body.data.rate_percent).toBe('7.25');
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, jurisdiction, applies_to)');
    expect(sql).toContain('active = true');
  });

  it('POST /items returns 422 when ratePercent is out of range', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ jurisdiction: 'CA', ratePercent: 150 });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ jurisdiction: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only active rules, tenant-wide with no user_id filter', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RULE_ID, jurisdiction: 'CA', rate_percent: '7.25', applies_to: 'all', active: true, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(RULE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE active = true');
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id deactivates a rule with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: RULE_ID }]);

    const res = await request(buildApp()).delete(`/items/${RULE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(RULE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET active = false');
    expect(params).toEqual([RULE_ID]);
  });

  it('DELETE /items/:id returns 404 when rule not found or already inactive', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${RULE_ID}`);

    expect(res.status).toBe(404);
  });
});
