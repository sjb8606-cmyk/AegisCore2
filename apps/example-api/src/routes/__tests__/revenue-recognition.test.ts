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
import { revenueRecognitionRouter } from '../revenue-recognition';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SCHEDULE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', revenueRecognitionRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('revenue-recognition routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items creates a schedule with a valid date range and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SCHEDULE_ID, contract_ref: 'CONTRACT-001', total_amount_cents: '1200000', recognition_start: '2026-01-01', recognition_end: '2026-12-31', method: 'straight_line', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ contractRef: 'CONTRACT-001', totalAmountCents: 1200000, recognitionStart: '2026-01-01', recognitionEnd: '2026-12-31' });

    expect(res.status).toBe(201);
    expect(res.body.data.method).toBe('straight_line');
    expect(res.body.data.id).toBe(SCHEDULE_ID);
  });

  it('POST /items returns 422 when recognitionEnd is before recognitionStart (manual business check)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ contractRef: 'CONTRACT-002', totalAmountCents: 1000, recognitionStart: '2026-12-31', recognitionEnd: '2026-01-01' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/recognitionEnd must not be before recognitionStart/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items returns 422 on an invalid method value', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ contractRef: 'CONTRACT-003', totalAmountCents: 1000, recognitionStart: '2026-01-01', recognitionEnd: '2026-01-02', method: 'lump_sum' });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ contractRef: '', totalAmountCents: -1 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated schedules scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SCHEDULE_ID, contract_ref: 'CONTRACT-001', total_amount_cents: '1200000', recognition_start: '2026-01-01', recognition_end: '2026-12-31', method: 'milestone', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(SCHEDULE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a schedule owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SCHEDULE_ID }]);

    const res = await request(buildApp()).delete(`/items/${SCHEDULE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SCHEDULE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([SCHEDULE_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when schedule not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SCHEDULE_ID}`);

    expect(res.status).toBe(404);
  });
});
