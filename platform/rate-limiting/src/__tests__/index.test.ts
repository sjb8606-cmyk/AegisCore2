import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockGetTierConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/entitlements', () => ({
  getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return { ...actual };
});

import {
  createOrUpdateConfig,
  resolveConfig,
  addAccessListEntry,
  evaluateAccessList,
  checkLimit,
  recordBreach,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

function defaultTier(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      fixedWindow: true,
      perTenantConfig: true,
      allowDenyList: true,
      ...(overrides.tiers as object),
    },
    limits: {
      defaultRequestsPerMinute: 1000,
      maxConfiguredLimitsPerTenant: 500,
      ...(overrides.limits as object),
    },
  };
}

beforeEach(() => {
  // mockReset clears the once-queue; clearAllMocks alone does not
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('createOrUpdateConfig', () => {
  it('upserts a config', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'cfg-1', scope: 'tenant', requests: 100 }]);

    const row = await createOrUpdateConfig(TENANT, {
      scope: 'tenant',
      algorithm: 'fixed_window',
      requests: 100,
      window_seconds: 60,
    });
    expect(row.requests).toBe(100);
  });

  it('rejects invalid payload', async () => {
    await expect(
      createOrUpdateConfig(TENANT, { scope: 'tenant', requests: -1, window_seconds: 60 }),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when core disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      createOrUpdateConfig(TENANT, {
        scope: 'tenant', requests: 10, window_seconds: 60,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid tenant id', async () => {
    await expect(
      createOrUpdateConfig('bad', { scope: 'tenant', requests: 10, window_seconds: 60 }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid tenant/i) });
  });
});

describe('resolveConfig', () => {
  it('returns exact match when present', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { scope: 'user', scope_key: 'u1', requests: 50, window_seconds: 60, active: true },
    ]);
    const cfg = await resolveConfig(TENANT, 'user', 'u1');
    expect(cfg.requests).toBe(50);
  });

  it('falls back to static default when no DB row', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const cfg = await resolveConfig(TENANT, 'user', 'u1');
    expect(cfg.requests).toBe(1000);
    expect(cfg._source).toBe('default');
  });
});

describe('access list', () => {
  it('addAccessListEntry upserts', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { list_type: 'deny', match_type: 'ip', match_value: '1.2.3.4' },
    ]);
    const row = await addAccessListEntry(TENANT, {
      list_type: 'deny', match_type: 'ip', match_value: '1.2.3.4', reason: 'abuse',
    });
    expect(row.list_type).toBe('deny');
  });

  it('evaluateAccessList returns deny', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ list_type: 'deny' }]);
    expect(await evaluateAccessList(TENANT, 'ip', '1.2.3.4')).toBe('deny');
  });

  it('evaluateAccessList returns allow', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ list_type: 'allow' }]);
    expect(await evaluateAccessList(TENANT, 'user_id', TENANT)).toBe('allow');
  });

  it('evaluateAccessList returns none', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    expect(await evaluateAccessList(TENANT, 'ip', '9.9.9.9')).toBe('none');
  });
});

describe('checkLimit', () => {
  it('allows when under limit', async () => {
    // access list (none) → exact config miss → tenant default miss → static default
    mockWithTenantQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await checkLimit(TENANT, {
      scope: 'tenant',
      current_count: 10,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(990);
  });

  it('denies and records breach when over limit', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([]) // access list
      .mockResolvedValueOnce([]) // exact config
      .mockResolvedValueOnce([]) // tenant default
      .mockResolvedValueOnce([{ id: 'breach-1' }]); // recordBreach

    const result = await checkLimit(TENANT, {
      scope: 'tenant',
      current_count: 1001,
      actor_ip: '1.2.3.4',
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('short-circuits on deny list', async () => {
    // Only the access-list query should run; no config resolution after deny
    mockWithTenantQuery.mockResolvedValueOnce([{ list_type: 'deny' }]);

    const result = await checkLimit(TENANT, {
      scope: 'tenant',
      current_count: 0,
      actor_ip: '1.2.3.4',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('deny_list');
  });
});

describe('recordBreach', () => {
  it('inserts a breach row', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'b1' }]);
    const row = await recordBreach(TENANT, {
      scope: 'tenant',
      limit_value: 100,
      request_count: 101,
      window_seconds: 60,
    });
    expect(row.id).toBe('b1');
  });
});
