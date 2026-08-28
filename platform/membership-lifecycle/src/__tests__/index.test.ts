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
      maxFreezeDays: 90,
      allowAccessWhileFrozen: false,
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
  activateMembership,
  freezeMembership,
  unfreezeMembership,
  cancelMembership,
  assertEntitled,
  __resetMembershipLifecycleStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const memberId = '00000000-0000-4000-8000-0000000000cc';

describe('membership-lifecycle', () => {
  beforeEach(() => {
    __resetMembershipLifecycleStore();
    vi.clearAllMocks();
  });

  it('activates and asserts entitlement', async () => {
    const m = await activateMembership(tenantId, actorId, {
      memberId,
      planId: 'plan-basic',
    });
    const ent = await assertEntitled(tenantId, memberId);
    expect(ent.entitled).toBe(true);
    expect(ent.membershipId).toBe(m.id);
  });

  it('blocks access while frozen', async () => {
    const m = await activateMembership(tenantId, actorId, {
      memberId,
      planId: 'plan-basic',
    });
    await freezeMembership(tenantId, actorId, m.id, { reason: 'travel' });
    await expect(assertEntitled(tenantId, memberId)).rejects.toThrow(/frozen/i);
    await unfreezeMembership(tenantId, actorId, m.id);
    const ent = await assertEntitled(tenantId, memberId);
    expect(ent.entitled).toBe(true);
  });

  it('cancels membership and blocks entitlement', async () => {
    const m = await activateMembership(tenantId, actorId, {
      memberId,
      planId: 'plan-pro',
    });
    await cancelMembership(tenantId, actorId, m.id);
    await expect(assertEntitled(tenantId, memberId)).rejects.toThrow(
      /no active membership/i,
    );
  });
});
