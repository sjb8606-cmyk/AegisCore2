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
import { iotAlertsRouter } from '../iot-alerts';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const DEVICE_ID = '44444444-4444-4444-4444-444444444444';
const ALERT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', iotAlertsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('iot-alerts routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items records a device alert and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ALERT_ID, device_id: DEVICE_ID, alert_type: 'temperature.high', severity: 'critical', message: 'Sensor exceeded threshold', acknowledged_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ deviceId: DEVICE_ID, alertType: 'temperature.high', severity: 'critical', message: 'Sensor exceeded threshold' });

    expect(res.status).toBe(201);
    expect(res.body.data.severity).toBe('critical');
    expect(res.body.data.id).toBe(ALERT_ID);
  });

  it('POST /items returns 422 on invalid body (bad deviceId)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ deviceId: 'not-a-uuid', alertType: 'x', message: 'y' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns alerts tenant-wide, no user_id filter passed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: ALERT_ID, device_id: DEVICE_ID, alert_type: 'temperature.high', severity: 'warning', message: 'Rising temp', acknowledged_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(ALERT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).not.toContain(USER_ID);
  });

  it('DELETE /items/:id dismisses an alert with no ownership check (only id passed)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: ALERT_ID }]);

    const res = await request(buildApp()).delete(`/items/${ALERT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ALERT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([ALERT_ID]);
  });

  it('DELETE /items/:id returns 404 when alert not found', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${ALERT_ID}`);

    expect(res.status).toBe(404);
  });
});
