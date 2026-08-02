import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { iotDevicesRouter } from '../iot-devices';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const DEVICE_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', iotDevicesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('iot-devices routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items registers a device and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DEVICE_ID, name: 'Warehouse Sensor 1', device_type: 'temperature_sensor', serial_number: 'SN-001', status: 'active', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'Warehouse Sensor 1', deviceType: 'temperature_sensor', serialNumber: 'SN-001' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.id).toBe(DEVICE_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '', deviceType: '', serialNumber: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns devices tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: DEVICE_ID, name: 'Warehouse Sensor 1', device_type: 'temperature_sensor', serial_number: 'SN-001', status: 'active', created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(DEVICE_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id decommissions a device via state-guarded UPDATE, no ownership check', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: DEVICE_ID }]);

    const res = await request(buildApp()).delete(`/items/${DEVICE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(DEVICE_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain(`SET status = 'decommissioned'`);
    expect(sql).toContain(`status != 'decommissioned'`);
    expect(params).toEqual([DEVICE_ID]);
  });

  it('DELETE /items/:id returns 404 when device not found or already decommissioned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${DEVICE_ID}`);

    expect(res.status).toBe(404);
  });
});
