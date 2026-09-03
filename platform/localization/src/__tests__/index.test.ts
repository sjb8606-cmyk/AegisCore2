import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/auth is only imported as a TYPE (AuthenticatedRequest) here --
// no runtime mock needed. @platform/utils (AppError/ErrorCode) is real.

import { withTenantQuery } from '@platform/tenancy';
import { localizationRouter } from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Test-only stand-in for the real upstream auth middleware: reads
  // x-test-* headers and sets req.auth accordingly. Omitting the headers
  // simulates a request that reached this router with no authenticated
  // context at all.
  app.use((req: any, _res, next) => {
    const tid = req.header('x-test-tenant-id');
    const uid = req.header('x-test-user-id');
    if (tid && uid) {
      req.auth = { tenantId: tid, sub: uid, roles: [] };
    }
    next();
  });
  app.use('/', localizationRouter);
  return app;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();
});

describe('PUT /preference', () => {
  it('upserts the locale preference for the authenticated user', async () => {
    const row = { tenant_id: tenantId, user_id: userId, locale: 'en-US', timezone: null };
    mockedWithTenantQuery.mockResolvedValueOnce([row]);

    const res = await request(app)
      .put('/preference')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId)
      .send({ locale: 'en-US' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
    const [sql, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params).toEqual([tenantId, userId, 'en-US']);

    // GAP: timezone is hardcoded to SQL `null` in the INSERT -- there is
    // no way to actually set a user's timezone via this endpoint despite
    // the column existing. Real fix: accept an optional timezone field in
    // SetLocalePreferenceSchema and pass it through instead of a literal.
    expect(sql).toContain('VALUES ($1, $2, $3, null)');
  });

  it('BUG: missing auth context is reported as 400, not 401', async () => {
    // extractContext throws AppError('Missing authenticated context',
    // ErrorCode.UNAUTHORIZED) here, which maps to HTTP 401 via the shared
    // HTTP_STATUS table -- but this router's inline catch always responds
    // with 400 regardless of the real error code. Real fix: use the
    // shared globalErrorHandler (or res.status(err.statusCode || 500))
    // instead of a hardcoded 400.
    const res = await request(app).put('/preference').send({ locale: 'en-US' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing authenticated context');
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects an invalid locale format', async () => {
    const res = await request(app)
      .put('/preference')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId)
      .send({ locale: 'ENGLISH' });

    expect(res.status).toBe(400);
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('PUT /tenant-config', () => {
  it('BUG: writes/reads columns literally named default_theme/enforce_theme, not locale columns', async () => {
    const row = { tenant_id: tenantId, default_theme: 'fr', enforce_theme: true };
    mockedWithTenantQuery.mockResolvedValueOnce([row]);

    const res = await request(app)
      .put('/tenant-config')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId)
      .send({ default_locale: 'fr', enforce_locale: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);

    // Real fix: this table/these columns look copy-pasted from a UI-theme
    // feature. Either the table needs real default_locale/enforce_locale
    // columns, or this endpoint is silently writing into an unrelated
    // theme feature's storage.
    const [sql] = mockedWithTenantQuery.mock.calls[0];
    expect(sql).toContain('tenant_locale_config');
    expect(sql).toContain('default_theme');
    expect(sql).toContain('enforce_theme');
    expect(sql).not.toContain('default_locale');
    expect(sql).not.toContain('enforce_locale');
  });

  it('BUG: missing auth context is reported as 400, not 401', async () => {
    const res = await request(app).put('/tenant-config').send({ default_locale: 'fr' });
    expect(res.status).toBe(400);
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('GET /resolve', () => {
  it('BUG: tenant-enforced Arabic locale still reports direction "ltr"', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([{ default_locale: 'ar', enforce_locale: true }]);

    const res = await request(app)
      .get('/resolve')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId);

    // Real fix: compute direction from `tenant.default_locale` here too,
    // the same way the user-preference branch does below, instead of
    // hardcoding 'ltr'.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'ar', direction: 'ltr' });
  });

  it('BUG: the true fallback branch (no enforcement, no user pref) also hardcodes direction "ltr" for a real Arabic tenant default', async () => {
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ default_locale: 'ar', enforce_locale: false }]) // tenant config row exists
      .mockResolvedValueOnce([]); // no user preference

    const res = await request(app)
      .get('/resolve')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'ar', direction: 'ltr' });
  });

  it('correctly computes rtl direction only in the user-preference branch, for Arabic', async () => {
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ default_locale: 'en', enforce_locale: false }])
      .mockResolvedValueOnce([{ locale: 'ar' }]);

    const res = await request(app)
      .get('/resolve')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'ar', direction: 'rtl' });
  });

  it('LIMITATION: Hebrew is a real RTL locale but is still reported as "ltr" -- only "ar" is recognized', async () => {
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ default_locale: 'en', enforce_locale: false }])
      .mockResolvedValueOnce([{ locale: 'he' }]);

    // Real fix: check against a set of known RTL locale codes (ar, he,
    // fa, ur, ...) instead of a single hardcoded '=== ar' comparison.
    const res = await request(app)
      .get('/resolve')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'he', direction: 'ltr' });
  });

  it('falls back to the hardcoded default (en/ltr) when no tenant config row exists at all', async () => {
    mockedWithTenantQuery
      .mockResolvedValueOnce([]) // no tenant_locale_config row
      .mockResolvedValueOnce([]); // no user preference

    const res = await request(app)
      .get('/resolve')
      .set('x-test-tenant-id', tenantId)
      .set('x-test-user-id', userId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locale: 'en', direction: 'ltr' });
  });

  it('BUG: missing auth context is reported as 400, not 401', async () => {
    const res = await request(app).get('/resolve');
    expect(res.status).toBe(400);
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});
