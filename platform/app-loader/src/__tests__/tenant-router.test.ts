import { describe, it, expect, beforeEach, vi } from 'vitest';

// withTenantQuery is the real DB-touching boundary; its own correctness
// (RLS session var, transaction, rollback) is already covered by
// platform/tenancy's own isolation.test.ts against a mocked pg client.
// This suite's job is the orchestration on top of it: caching, the
// not-found case, and cache invalidation -- so withTenantQuery is mocked
// here, not the tenancy internals.
const withTenantQueryMock = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => withTenantQueryMock(...args),
}));

import { resolveAppIdForTenant, clearAppIdCache } from '../tenant-router';
import { AppError } from '@platform/utils';

const TENANT_A = '660f9500-f30c-52e5-b827-557766550001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

beforeEach(() => {
  withTenantQueryMock.mockReset();
  clearAppIdCache();
});

describe('resolveAppIdForTenant', () => {
  it('returns the app_id for a tenant with a real mapping', async () => {
    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);

    const appId = await resolveAppIdForTenant(TENANT_A);

    expect(appId).toBe('tidelock');
    expect(withTenantQueryMock).toHaveBeenCalledWith(
      'SELECT app_id FROM tenant_apps WHERE tenant_id = $1',
      [TENANT_A],
      TENANT_A,
    );
  });

  it('throws AppError NOT_FOUND when the tenant has no app assignment', async () => {
    // Persistent mock: this test calls resolveAppIdForTenant twice
    withTenantQueryMock.mockResolvedValue([]);

    await expect(resolveAppIdForTenant(TENANT_A)).rejects.toThrow(AppError);
    await expect(resolveAppIdForTenant(TENANT_A)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('caches the result -- a second call within the TTL does not hit the DB again', async () => {
    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);

    const first = await resolveAppIdForTenant(TENANT_A);
    const second = await resolveAppIdForTenant(TENANT_A);

    expect(first).toBe('tidelock');
    expect(second).toBe('tidelock');
    expect(withTenantQueryMock).toHaveBeenCalledTimes(1);
  });

  it('does not let one tenant\'s cached result leak into another tenant\'s lookup', async () => {
    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);
    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock-italy' }]);

    const a = await resolveAppIdForTenant(TENANT_A);
    const b = await resolveAppIdForTenant(TENANT_B);

    expect(a).toBe('tidelock');
    expect(b).toBe('tidelock-italy');
    expect(withTenantQueryMock).toHaveBeenCalledTimes(2);
  });

  it('clearAppIdCache(tenantId) forces the next lookup for that tenant back to the DB', async () => {
    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);
    await resolveAppIdForTenant(TENANT_A);

    clearAppIdCache(TENANT_A);

    withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock-italy' }]);
    const afterReassignment = await resolveAppIdForTenant(TENANT_A);

    expect(afterReassignment).toBe('tidelock-italy');
    expect(withTenantQueryMock).toHaveBeenCalledTimes(2);
  });

  it('respects TTL expiry -- a stale cache entry is not reused', async () => {
    vi.useFakeTimers();
    try {
      withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);
      await resolveAppIdForTenant(TENANT_A);

      vi.advanceTimersByTime(31_000); // past the 30s TTL

      withTenantQueryMock.mockResolvedValueOnce([{ app_id: 'tidelock' }]);
      await resolveAppIdForTenant(TENANT_A);

      expect(withTenantQueryMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
