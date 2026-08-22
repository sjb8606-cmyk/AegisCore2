import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      defaultRole: 'viewer',
      superPermission: '*',
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createRole,
  assignRole,
  check,
  assertPermission,
  permissionMatches,
  __resetRbacStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const userId = '00000000-0000-4000-8000-0000000000bb';

describe('rbac', () => {
  beforeEach(() => {
    __resetRbacStore();
    vi.clearAllMocks();
  });

  it('permissionMatches exact and wildcard', () => {
    expect(permissionMatches(['inventory.read'], 'inventory.read')).toBe(true);
    expect(permissionMatches(['inventory.*'], 'inventory.write')).toBe(true);
    expect(permissionMatches(['*'], 'anything')).toBe(true);
    expect(permissionMatches(['jobs.read'], 'jobs.write')).toBe(false);
  });

  it('assigns role and checks permission', async () => {
    const role = await createRole(tenantId, actorId, {
      name: 'dispatcher',
      permissions: ['jobs.read', 'jobs.assign', 'jobs.*'],
    });
    await assignRole(tenantId, actorId, {
      userId,
      roleId: role.id,
    });
    const ok = await check(tenantId, userId, 'jobs.assign');
    expect(ok.allowed).toBe(true);
    await assertPermission(tenantId, userId, 'jobs.close');
  });

  it('denies without binding', async () => {
    const result = await check(tenantId, userId, 'admin.panel');
    expect(result.allowed).toBe(false);
    await expect(
      assertPermission(tenantId, userId, 'admin.panel'),
    ).rejects.toThrow(/Forbidden/i);
  });
});
