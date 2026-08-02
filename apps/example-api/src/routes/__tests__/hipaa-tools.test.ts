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
import { hipaaToolsRouter } from '../hipaa-tools';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOG_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', hipaaToolsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('hipaa-tools routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no DELETE /items/:id route (access logs are compliance records)', async () => {
    const res = await request(buildApp()).delete(`/items/${LOG_ID}`);

    expect(res.status).toBe(404);
  });

  it('POST /items logs a PHI access and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: LOG_ID, accessor_id: USER_ID, access_reason: 'treatment review', accessed_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ patientRef: 'PT-00123', accessReason: 'treatment review' });

    expect(res.status).toBe(201);
    expect(res.body.data.access_reason).toBe('treatment review');
    expect(res.body.data.accessor_id).toBe(USER_ID);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ patientRef: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 when patientRef query param is missing', async () => {
    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(400);
  });

  it('GET /items returns 400 on invalid pagination query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ patientRef: 'PT-00123', limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns logs for the given patient, ordered by accessed_at', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: LOG_ID, accessor_id: USER_ID, access_reason: 'billing inquiry', accessed_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .get('/items')
      .query({ patientRef: 'PT-00123' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(LOG_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('WHERE patient_ref = $1');
    expect(sql).toContain('ORDER BY accessed_at');
    expect(params[0]).toBe('PT-00123');
  });
});
