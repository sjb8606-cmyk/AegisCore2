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
import { dropshippingRouter } from '../dropshipping';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '44444444-4444-4444-4444-444444444444';
const DROPSHIP_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', dropshippingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('dropshipping routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items routes an order to a supplier and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DROPSHIP_ID, order_id: ORDER_ID, supplier_name: 'Acme Supply Co', supplier_order_ref: null, status: 'pending', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ orderId: ORDER_ID, supplierName: 'Acme Supply Co' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.id).toBe(DROPSHIP_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ orderId: 'not-a-uuid', supplierName: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns dropship orders tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DROPSHIP_ID, order_id: ORDER_ID, supplier_name: 'Acme Supply Co', supplier_order_ref: 'ACME-9981', status: 'sent_to_supplier', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(DROPSHIP_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id cancels an order via a NOT IN state guard, no ownership check', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: DROPSHIP_ID }]);

    const res = await request(buildApp()).delete(`/items/${DROPSHIP_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(DROPSHIP_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'cancelled'`);
    expect(sql).toContain(`NOT IN ('fulfilled', 'cancelled')`);
    expect(params).toEqual([DROPSHIP_ID]);
  });

  it('DELETE /items/:id returns 404 when order not found or already fulfilled/cancelled', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${DROPSHIP_ID}`);

    expect(res.status).toBe(404);
  });
});
