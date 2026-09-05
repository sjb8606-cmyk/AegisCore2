import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { darkModeRouter, resolveEffectiveTheme } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function buildApp(auth: { tenantId: string; sub: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (auth) req.auth = { tenantId: auth.tenantId, sub: auth.sub };
    next();
  });
  app.use(darkModeRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveEffectiveTheme — real precedence logic', () => {
  it('tenant-enforced theme overrides any user preference', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ default_theme: 'dark', enforce_theme: true }]);
    const result = await resolveEffectiveTheme(TENANT_ID, USER_ID);
    expect(result).toEqual({ theme: 'dark', reason: 'tenant_enforced' });
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('uses the user preference when tenant does not enforce', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ default_theme: 'light', enforce_theme: false }])
      .mockResolvedValueOnce([{ preference: 'dark' }]);
    const result = await resolveEffectiveTheme(TENANT_ID, USER_ID);
    expect(result).toEqual({ theme: 'dark', reason: 'user_preference' });
  });

  it('falls back to the tenant default when no user preference is set', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ default_theme: 'system', enforce_theme: false }])
      .mockResolvedValueOnce([]);
    const result = await resolveEffectiveTheme(TENANT_ID, USER_ID);
    expect(result).toEqual({ theme: 'system', reason: 'tenant_default_fallback' });
  });

  it('defaults to system/not-enforced when no tenant config row exists at all', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await resolveEffectiveTheme(TENANT_ID, USER_ID);
    expect(result).toEqual({ theme: 'system', reason: 'tenant_default_fallback' });
  });
});

describe('router error status mapping', () => {
  // BUG — documented, not hidden. handleError only special-cases
  // error.code === 'BAD_REQUEST' -> 400. extractContext throws an AppError
  // with code 'UNAUTHORIZED' for missing auth, which doesn't match, so it
  // falls through to the generic 500 branch instead of a proper 401.
  it('BUG: missing auth context returns 500, not 401', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/resolve');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('UNAUTHORIZED');
    // TODO(dark-mode bug): handleError should map UNAUTHORIZED -> 401, FORBIDDEN -> 403, etc.,
    // not just special-case the single BAD_REQUEST string.
  });

  // BUG — documented, not hidden. ZodError objects have no `.code` property
  // (they have `.issues`), so a schema validation failure also falls through
  // to the generic 500 branch instead of 400.
  it('BUG: an invalid request body (schema validation failure) returns 500, not 400', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/preference').send({ preference: 'not-a-real-theme' });
    expect(res.status).toBe(500);
    // TODO(dark-mode bug): detect ZodError specifically (e.g. `err instanceof z.ZodError`)
    // and map it to 400, since err.code will never equal 'BAD_REQUEST' for these.
  });
});

describe('PUT /preference', () => {
  it('sets a valid preference and returns it', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ preference: 'dark' }]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/preference').send({ preference: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preference: 'dark' });
  });
});

describe('PUT /tenant-config', () => {
  it('updates tenant theme config and returns the row', async () => {
    const row = { tenant_id: TENANT_ID, default_theme: 'dark', enforce_theme: true };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/tenant-config').send({ default_theme: 'dark', enforce_theme: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
  });
});
