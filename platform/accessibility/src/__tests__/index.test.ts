import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { accessibilityRouter } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function buildApp(auth: { tenantId: string; sub: string } | null) {
  const app = express();
  app.use(express.json());
  // Simulates what the real auth middleware attaches to req before this router runs
  app.use((req: any, _res, next) => {
    if (auth) req.auth = { tenantId: auth.tenantId, sub: auth.sub };
    next();
  });
  app.use(accessibilityRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /preferences', () => {
  it('returns 400 when there is no authenticated context', async () => {
    const app = buildApp(null);
    const res = await request(app).put('/preferences').send({ high_contrast: true });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects a font_scale outside the 0.8-2.0 bound', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/preferences').send({ font_scale: 5 });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('upserts valid preferences and returns the row', async () => {
    const row = { tenant_id: TENANT_ID, user_id: USER_ID, high_contrast: true, font_scale: 1.2 };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });

    const res = await request(app).put('/preferences').send({ high_contrast: true, font_scale: 1.2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[0]).toBe(TENANT_ID);
  });
});

describe('GET /resolve', () => {
  it('clamps a user font_scale to the tenant-enforced min/max', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ enforce_high_contrast: false, enforce_reduced_motion: false, min_font_scale: 0.8, max_font_scale: 1.5 }])
      .mockResolvedValueOnce([{ high_contrast: false, reduced_motion: false, font_scale: 3.0 }]); // over tenant max

    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).get('/resolve');

    expect(res.status).toBe(200);
    expect(res.body.font_scale).toBe(1.5); // clamped down to tenant max, not the raw 3.0
  });

  it('tenant-enforced high_contrast overrides a false user preference', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ enforce_high_contrast: true, enforce_reduced_motion: false, min_font_scale: 0.8, max_font_scale: 2.0 }])
      .mockResolvedValueOnce([{ high_contrast: false, reduced_motion: false, font_scale: 1.0 }]);

    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).get('/resolve');

    expect(res.body.high_contrast).toBe(true);
  });

  it('falls back to sane defaults when no rows exist yet for tenant or user', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([]) // no tenant_accessibility_config row
      .mockResolvedValueOnce([]); // no accessibility_preferences row

    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).get('/resolve');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      high_contrast: false,
      reduced_motion: false,
      font_scale: 1.0,
      screen_reader_hints: false,
      keyboard_nav_mode: false,
      focus_indicator: 'default',
    });
  });
});

describe('PUT /tenant-config', () => {
  it('returns 400 when there is no authenticated context', async () => {
    const app = buildApp(null);
    const res = await request(app).put('/tenant-config').send({ wcag_level: 'AAA' });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects an unsupported wcag_level', async () => {
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });
    const res = await request(app).put('/tenant-config').send({ wcag_level: 'Z' });
    expect(res.status).toBe(400);
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('upserts valid tenant config and returns the row', async () => {
    const row = { tenant_id: TENANT_ID, wcag_level: 'AAA', enforce_high_contrast: true };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const app = buildApp({ tenantId: TENANT_ID, sub: USER_ID });

    const res = await request(app).put('/tenant-config').send({ wcag_level: 'AAA', enforce_high_contrast: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[0]).toBe(TENANT_ID);
    expect(params[1]).toBe('AAA');
  });
});
