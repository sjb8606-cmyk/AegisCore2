import { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
/**
 * platform/tenancy/src/__tests__/isolation.test.ts
 *
 * Tests:
 * - Tenant context isolation (AsyncLocalStorage)
 * - Cross-tenant access prevention
 * - RLS session variable setting
 * - runWithTenant nesting
 */

import { getCurrentTenantId, runWithTenant, bindTenantToRequest, isValidTenantId } from '../resolver';
import { assertTenantOwnership, clearTenantSession, setTenantSession } from '../rls';
import { AppError, ErrorCode } from '@platform/utils';

// ── Mock DB client ─────────────────────────────────────────────

function makeMockClient() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 0 };
    }),
    _queries: queries,
  };
  return client;
}

// ─────────────────────────────────────────────────────────────
// ASYNC CONTEXT TESTS
// ─────────────────────────────────────────────────────────────

describe('tenant context isolation', () => {
  test('getCurrentTenantId throws outside tenant context', () => {
    expect(() => getCurrentTenantId()).toThrow('outside of tenant context');
  });

  test('runWithTenant provides correct tenantId', async () => {
    await runWithTenant('tenant-aaa', async () => {
      expect(getCurrentTenantId()).toBe('tenant-aaa');
    });
  });

  test('nested runWithTenant is isolated', async () => {
    await runWithTenant('tenant-outer', async () => {
      expect(getCurrentTenantId()).toBe('tenant-outer');

      await runWithTenant('tenant-inner', async () => {
        expect(getCurrentTenantId()).toBe('tenant-inner');
      });

      // Outer context restored after inner completes
      expect(getCurrentTenantId()).toBe('tenant-outer');
    });
  });

  test('concurrent requests use different contexts', async () => {
    const results: string[] = [];

    await Promise.all([
      runWithTenant('tenant-alpha', async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getCurrentTenantId());
      }),
      runWithTenant('tenant-beta', async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(getCurrentTenantId());
      }),
    ]);

    expect(results).toContain('tenant-alpha');
    expect(results).toContain('tenant-beta');
  });
});

// ─────────────────────────────────────────────────────────────
// CROSS-TENANT PROTECTION TESTS
// ─────────────────────────────────────────────────────────────

describe('cross-tenant access prevention', () => {
  test('assertTenantOwnership passes when tenantIds match', () => {
    expect(() =>
      assertTenantOwnership('tenant-aaa', 'tenant-aaa')
    ).not.toThrow();
  });

  test('assertTenantOwnership throws on mismatch', () => {
    expect(() =>
      assertTenantOwnership('tenant-aaa', 'tenant-bbb')
    ).toThrow('Resource not found'); // vague by design
  });

  test('error code is NOT_FOUND (not FORBIDDEN) to avoid information leak', () => {
    try {
      assertTenantOwnership('tenant-aaa', 'tenant-bbb');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.NOT_FOUND);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// RLS SESSION VARIABLE TESTS
// ─────────────────────────────────────────────────────────────

describe('RLS session setter', () => {
  test('setTenantSession calls set_config with correct tenant', async () => {
    const client = makeMockClient();
    await setTenantSession(client as any, 'tenant-xyz');

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('set_config'),
      ['tenant-xyz']
    );
  });

  test('setTenantSession rejects empty tenantId', async () => {
    const client = makeMockClient();
    await expect(setTenantSession(client as any, '')).rejects.toThrow('invalid tenantId');
  });

  test('clearTenantSession sets empty value', async () => {
    const client = makeMockClient();
    await clearTenantSession(client as any);
    const lastQuery = client._queries[client._queries.length - 1];
    expect(lastQuery.sql).toContain("''");
  });
});

// ─────────────────────────────────────────────────────────────
// TENANT ID VALIDATION TESTS
// ─────────────────────────────────────────────────────────────

describe('tenant ID validation', () => {
  test('accepts valid UUID', () => {
    expect(isValidTenantId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('accepts valid slug', () => {
    expect(isValidTenantId('acme-corp')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(isValidTenantId('')).toBe(false);
  });

  test('rejects path traversal', () => {
    expect(isValidTenantId('../etc/passwd')).toBe(false);
  });

  test('rejects SQL injection attempt', () => {
    expect(isValidTenantId("'; DROP TABLE tenants; --")).toBe(false);
  });
});
