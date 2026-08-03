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
import { payrollRouter } from '../payroll';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', payrollRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('payroll routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a draft run with a valid pay period and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RUN_ID, pay_period_start: '2026-01-01', pay_period_end: '2026-01-15', status: 'draft', total_gross_cents: '500000', created_at: new Date().toISOString(), completed_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ payPeriodStart: '2026-01-01', payPeriodEnd: '2026-01-15', totalGrossCents: 500000 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.id).toBe(RUN_ID);
  });

  it('POST /items returns 422 when payPeriodEnd is before payPeriodStart (manual business check)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ payPeriodStart: '2026-02-01', payPeriodEnd: '2026-01-01', totalGrossCents: 1000 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/payPeriodEnd must not be before payPeriodStart/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ payPeriodStart: 'not-a-date', payPeriodEnd: 'not-a-date', totalGrossCents: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated runs scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: RUN_ID, pay_period_start: '2026-01-01', pay_period_end: '2026-01-15', status: 'completed', total_gross_cents: '500000', created_at: new Date().toISOString(), completed_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(RUN_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id cancels a run via a state guard requiring status = draft exactly', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: RUN_ID }]);

    const res = await request(buildApp()).delete(`/items/${RUN_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(RUN_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'cancelled'`);
    expect(sql).toContain(`AND status = 'draft'`);
    expect(params).toEqual([RUN_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when run not found, not owned, or already past draft', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${RUN_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer in draft/);
  });
});
