import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return {
    ...actual,
    loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  };
});

import { getTierConfig, getTenantTier, setTenantTier, setFeatureOverride } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('entitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      tiers: { rateLimitConfig: true, allowDenyList: false },
      limits: { defaultRequestsPerMinute: 1000 },
    });
  });

  it('returns the static default when there are no overrides', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const cfg = await getTierConfig(TENANT, 'rateLimiting');
    expect(cfg.tiers.rateLimitConfig).toBe(true);
    expect(cfg.tiers.allowDenyList).toBe(false);
  });

  it('applies a per-tenant override on top of the default, leaving other flags untouched', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { override_key: 'allowDenyList', enabled: true },
    ]);
    const cfg = await getTierConfig(TENANT, 'rateLimiting');
    expect(cfg.tiers.allowDenyList).toBe(true);
    expect(cfg.tiers.rateLimitConfig).toBe(true);
  });

  it('rejects an invalid tenant id', async () => {
    await expect(getTierConfig('not-a-uuid', 'rateLimiting')).rejects.toMatchObject({
      message: expect.stringMatching(/invalid tenant id/i),
    });
  });

  it('getTenantTier defaults to standard when no row exists', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const tier = await getTenantTier(TENANT);
    expect(tier).toBe('standard');
  });

  it('getTenantTier returns the stored tier', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ tier: 'plus' }]);
    const tier = await getTenantTier(TENANT);
    expect(tier).toBe('plus');
  });

  it('setTenantTier upserts into tenant_tiers', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ tenant_id: TENANT, tier: 'plus' }]);
    const row = await setTenantTier(TENANT, { tier: 'plus' }, 'user-1');
    expect(row.tier).toBe('plus');
    const sql = String(mockWithTenantQuery.mock.calls[0][0]);
    expect(sql.toLowerCase()).toContain('insert into tenant_tiers');
    expect(sql.toLowerCase()).toContain('on conflict');
  });

  it('setFeatureOverride upserts into tenant_feature_overrides', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { tenant_id: TENANT, feature_name: 'rateLimiting', override_key: 'allowDenyList', enabled: true },
    ]);
    const row = await setFeatureOverride(
      TENANT,
      { feature_name: 'rateLimiting', override_key: 'allowDenyList', enabled: true, reason: 'pilot customer' },
      'user-1'
    );
    expect(row.enabled).toBe(true);
    const sql = String(mockWithTenantQuery.mock.calls[0][0]);
    expect(sql.toLowerCase()).toContain('insert into tenant_feature_overrides');
  });

  it('setFeatureOverride rejects a malformed payload', async () => {
    await expect(
      setFeatureOverride(TENANT, { feature_name: '', override_key: 'x', enabled: true }, 'user-1')
    ).rejects.toThrow();
  });
});
