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
import { taxReportingRouter } from '../tax-reporting';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const REPORT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', taxReportingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('tax-reporting routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has no DELETE /items/:id route (filed reports are historical/legal records)', async () => {
    const res = await request(buildApp()).delete(`/items/${REPORT_ID}`);

    expect(res.status).toBe(404);
  });

  it('POST /items generates a draft report with a valid period and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REPORT_ID, period_start: '2026-01-01', period_end: '2026-03-31', jurisdiction: 'CA', total_tax_cents: '450000', status: 'draft', created_at: new Date().toISOString(), filed_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ periodStart: '2026-01-01', periodEnd: '2026-03-31', jurisdiction: 'CA', totalTaxCents: 450000 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.id).toBe(REPORT_ID);
  });

  it('POST /items returns 422 when periodEnd is before periodStart (manual business check)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ periodStart: '2026-03-31', periodEnd: '2026-01-01', jurisdiction: 'CA', totalTaxCents: 1000 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/periodEnd must not be before periodStart/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ periodStart: 'not-a-date', periodEnd: 'not-a-date', jurisdiction: '', totalTaxCents: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated reports scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: REPORT_ID, period_start: '2026-01-01', period_end: '2026-03-31', jurisdiction: 'CA', total_tax_cents: '450000', status: 'filed', created_at: new Date().toISOString(), filed_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(REPORT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });
});
