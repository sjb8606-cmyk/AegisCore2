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
import { privacyControlsRouter } from '../privacy-controls';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', privacyControlsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('privacy-controls routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /items returns all-false defaults when no preferences row exists yet', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ marketing_opt_in: false, analytics_opt_in: false, data_sharing_opt_in: false, updated_at: null });
  });

  it('GET /items returns the stored row scoped to the user when one exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { marketing_opt_in: true, analytics_opt_in: false, data_sharing_opt_in: true, updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data.marketing_opt_in).toBe(true);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([USER_ID]);
  });

  it('PUT /items upserts preferences via ON CONFLICT (tenant_id, user_id)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { marketing_opt_in: true, analytics_opt_in: true, data_sharing_opt_in: false, updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .put('/items')
      .send({ marketingOptIn: true, analyticsOptIn: true, dataSharingOptIn: false });

    expect(res.status).toBe(200);
    expect(res.body.data.marketing_opt_in).toBe(true);
    expect(res.body.data.analytics_opt_in).toBe(true);
    const [sql] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, user_id)');
  });

  it('PUT /items returns 422 on invalid body (missing required boolean field)', async () => {
    const res = await request(buildApp())
      .put('/items')
      .send({ marketingOptIn: true, analyticsOptIn: true });

    expect(res.status).toBe(422);
  });

  it('has no POST or DELETE routes (singleton settings resource)', async () => {
    const postRes = await request(buildApp())
      .post('/items')
      .send({ marketingOptIn: true, analyticsOptIn: true, dataSharingOptIn: true });
    expect(postRes.status).toBe(404);

    const deleteRes = await request(buildApp()).delete('/items/33333333-3333-3333-3333-333333333333');
    expect(deleteRes.status).toBe(404);
  });
});
