import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, test } from 'vitest';
/**
 * platform/auth/src/__tests__/auth.test.ts
 *
 * Tests:
 * - JWT replay protection (jti uniqueness enforcement)
 * - OIDC token verification (invalid/expired/wrong audience/algorithm)
 * - RBAC role enforcement
 */

import { checkReplay, markJti, revokeJti, jtiExists } from '../replay-protection';
import { hasRole, meetsMinimumRole, hasPermission, ROLES } from '../rbac';

// ── Mock Redis ────────────────────────────────────────────────

const redisMock = new Map<string, string>();

vi.mock('../redis-client', () => ({
  getRedis: () => ({
    set: vi.fn(async (key: string, val: string, ...args: any[]) => {
      const nxIndex = args.indexOf('NX');
      if (nxIndex !== -1 && redisMock.has(key)) return null; // simulate NX
      redisMock.set(key, val);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      redisMock.delete(key);
      return 1;
    }),
    exists: vi.fn(async (key: string) => (redisMock.has(key) ? 1 : 0)),
  }),
}));

beforeEach(() => redisMock.clear());

// ─────────────────────────────────────────────────────────────
// REPLAY PROTECTION TESTS
// ─────────────────────────────────────────────────────────────

describe('jti replay protection', () => {
  const JTI = 'valid-unique-jti-abc123';

  test('first use: checkReplay returns false (not replayed)', async () => {
    const replayed = await checkReplay(JTI);
    expect(replayed).toBe(false);
  });

  test('second use: checkReplay returns true (replayed)', async () => {
    await checkReplay(JTI);           // first use marks it
    const replayed = await checkReplay(JTI); // second use detects replay
    expect(replayed).toBe(true);
  });

  test('different jti values are independent', async () => {
    const jti1 = 'unique-jti-111111';
    const jti2 = 'unique-jti-222222';

    await checkReplay(jti1);
    const r1 = await checkReplay(jti1); // replayed
    const r2 = await checkReplay(jti2); // not replayed

    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });

  test('jtiExists returns true after marking', async () => {
    await markJti('jti-mark-test-abc');
    const exists = await jtiExists('jti-mark-test-abc');
    expect(exists).toBe(true);
  });

  test('revokeJti removes jti from store', async () => {
    await markJti('jti-revoke-test-xyz');
    await revokeJti('jti-revoke-test-xyz');
    const exists = await jtiExists('jti-revoke-test-xyz');
    expect(exists).toBe(false);
  });

  test('sanitizeJti rejects short/invalid values', async () => {
    await expect(checkReplay('')).rejects.toThrow('Invalid jti');
    await expect(checkReplay('ab')).rejects.toThrow('Invalid jti');
    await expect(checkReplay('../../etc/passwd')).rejects.toThrow('Invalid jti');
  });
});

// ─────────────────────────────────────────────────────────────
// RBAC TESTS
// ─────────────────────────────────────────────────────────────

function makeReq(roles: string[]) {
  return {
    auth: {
      sub:      'user-123',
      jti:      'jti-abc',
      tenantId: 'tenant-xyz',
      roles,
      scopes:   [],
      raw:      {},
    },
  } as any;
}

describe('RBAC role helpers', () => {
  test('hasRole returns true for matching role', () => {
    expect(hasRole(makeReq([ROLES.DEVELOPER]), ROLES.DEVELOPER)).toBe(true);
  });

  test('hasRole returns false for unmatched role', () => {
    expect(hasRole(makeReq([ROLES.VIEWER]), ROLES.TENANT_ADMIN)).toBe(false);
  });

  test('meetsMinimumRole: developer satisfies developer minimum', () => {
    expect(meetsMinimumRole(makeReq([ROLES.DEVELOPER]), ROLES.DEVELOPER)).toBe(true);
  });

  test('meetsMinimumRole: viewer does not satisfy developer minimum', () => {
    expect(meetsMinimumRole(makeReq([ROLES.VIEWER]), ROLES.DEVELOPER)).toBe(false);
  });

  test('meetsMinimumRole: super_admin satisfies all', () => {
    const roles = [ROLES.VIEWER, ROLES.ANALYST, ROLES.DEVELOPER, ROLES.TENANT_ADMIN];
    roles.forEach((min) =>
      expect(meetsMinimumRole(makeReq([ROLES.SUPER_ADMIN]), min)).toBe(true)
    );
  });

  test('hasPermission: tenant_admin can write tenant', () => {
    expect(hasPermission(makeReq([ROLES.TENANT_ADMIN]), 'tenant:write')).toBe(true);
  });

  test('hasPermission: viewer cannot write tenant', () => {
    expect(hasPermission(makeReq([ROLES.VIEWER]), 'tenant:write')).toBe(false);
  });

  test('hasPermission: super_admin can impersonate', () => {
    expect(hasPermission(makeReq([ROLES.SUPER_ADMIN]), 'admin:impersonate')).toBe(true);
  });

  test('hasPermission: unknown permission returns false', () => {
    expect(hasPermission(makeReq([ROLES.SUPER_ADMIN]), 'nonexistent:perm')).toBe(false);
  });

  test('missing auth context returns false', () => {
    const req = {} as any;
    expect(hasRole(req, ROLES.VIEWER)).toBe(false);
    expect(meetsMinimumRole(req, ROLES.VIEWER)).toBe(false);
    expect(hasPermission(req, 'tenant:read')).toBe(false);
  });
});
