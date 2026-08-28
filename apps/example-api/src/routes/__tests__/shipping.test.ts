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
import { shippingRouter } from '../shipping';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '44444444-4444-4444-4444-444444444444';
const SHIPMENT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', shippingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('shipping routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items creates a shipment already in shipped status with shipped_at set', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SHIPMENT_ID, order_id: ORDER_ID, carrier: 'UPS', tracking_number: '1Z999AA1', status: 'shipped', shipped_at: new Date().toISOString(), delivered_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ orderId: ORDER_ID, carrier: 'UPS', trackingNumber: '1Z999AA1' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('shipped');
    expect(res.body.data.shipped_at).toBeTruthy();
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`'shipped', NOW()`);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ orderId: 'not-a-uuid', carrier: '', trackingNumber: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns shipments tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SHIPMENT_ID, order_id: ORDER_ID, carrier: 'UPS', tracking_number: '1Z999AA1', status: 'in_transit', shipped_at: new Date().toISOString(), delivered_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(SHIPMENT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id cancels a shipment via state-guarded UPDATE, not a hard delete', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SHIPMENT_ID }]);

    const res = await request(buildApp()).delete(`/items/${SHIPMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SHIPMENT_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'cancelled'`);
    expect(sql).toContain(`NOT IN ('delivered', 'cancelled')`);
    expect(params).toEqual([SHIPMENT_ID]);
  });

  it('DELETE /items/:id returns 404 when shipment not found', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SHIPMENT_ID}`);

    expect(res.status).toBe(404);
  });

  it('DELETE /items/:id returns 404 when shipment is already delivered or cancelled', async () => {
    // the state guard means an already-delivered/cancelled shipment returns
    // zero rows, same as a not-found shipment
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SHIPMENT_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/already delivered\/cancelled/);
  });
});
