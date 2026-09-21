import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const createTenant = vi.fn();
const getTenantForUser = vi.fn();

vi.mock('../../../../platform/tenant-onboarding/src/index', () => ({
  TenantOnboardingService: {
    createTenant: (...args: unknown[]) => createTenant(...args),
    getTenantForUser: (...args: unknown[]) => getTenantForUser(...args),
  },
}));

import { onboardingRouter } from '../onboarding';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const TENANT = { id: '660f9500-f30c-52e5-b827-557766550001', name: 'Acme Seafood' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, roles: ['owner'] };
    next();
  });
  app.use('/api/onboarding', onboardingRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Internal error' });
  });
  return app;
}

describe('tidelock-api onboarding routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /api/onboarding creates a tenant and returns 201 with note about session', async () => {
    createTenant.mockResolvedValueOnce(TENANT);
    const res = await request(buildApp()).post('/api/onboarding').send({ name: 'Acme Seafood', region: 'NB' });
    expect(res.status).toBe(201);
    expect(res.body.tenant).toEqual(TENANT);
    expect(typeof res.body.note).toBe('string');
    expect(createTenant).toHaveBeenCalledWith(USER_ID, { name: 'Acme Seafood', region: 'NB' });
  });

  it('POST /api/onboarding propagates service errors as 4xx/5xx', async () => {
    const err: any = new Error('Name is required');
    err.statusCode = 422;
    createTenant.mockRejectedValueOnce(err);
    const res = await request(buildApp()).post('/api/onboarding').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/onboarding/me returns the tenant for the authenticated user', async () => {
    getTenantForUser.mockResolvedValueOnce(TENANT);
    const res = await request(buildApp()).get('/api/onboarding/me');
    expect(res.status).toBe(200);
    expect(res.body.tenant).toEqual(TENANT);
  });

  it('GET /api/onboarding/me returns 404 when user has no tenant', async () => {
    const err: any = new Error('No tenant found');
    err.statusCode = 404;
    getTenantForUser.mockRejectedValueOnce(err);
    const res = await request(buildApp()).get('/api/onboarding/me');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
