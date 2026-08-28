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
import { discountsRouter } from '../discounts';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const DISCOUNT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', discountsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('discounts routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a valid percentage discount and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DISCOUNT_ID, code: 'SUMMER25', discount_type: 'percentage', discount_value: 25, max_redemptions: null, redemption_count: 0, expires_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ code: 'SUMMER25', discountType: 'percentage', discountValue: 25 });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('SUMMER25');
    expect(res.body.data.id).toBe(DISCOUNT_ID);
  });

  it('POST /items returns 422 when a percentage discount exceeds 100 (manual business check)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ code: 'TOOMUCH', discountType: 'percentage', discountValue: 150 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/cannot exceed 100/);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('POST /items allows a fixed_amount discount value over 100', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DISCOUNT_ID, code: 'BIGSAVE', discount_type: 'fixed_amount', discount_value: 5000, max_redemptions: null, redemption_count: 0, expires_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ code: 'BIGSAVE', discountType: 'fixed_amount', discountValue: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.discount_value).toBe(5000);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ code: '', discountType: 'percentage', discountValue: -5 });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns discount codes tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DISCOUNT_ID, code: 'SUMMER25', discount_type: 'percentage', discount_value: 25, max_redemptions: null, redemption_count: 0, expires_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(DISCOUNT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id removes a discount code with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: DISCOUNT_ID }]);

    const res = await request(buildApp()).delete(`/items/${DISCOUNT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(DISCOUNT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([DISCOUNT_ID]);
  });

  it('DELETE /items/:id returns 404 when discount code not found', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${DISCOUNT_ID}`);

    expect(res.status).toBe(404);
  });
});
