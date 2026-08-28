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
      requireEntitlement: true,
      locations: ['main_door', 'gym_floor', 'studio'],
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
  attemptAccess,
  listAccessEvents,
  getDenialCount,
  setEntitlementFn,
  __resetAccessControlStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const memberId = 'member-1';

describe('access-control-events', () => {
  beforeEach(() => {
    __resetAccessControlStore();
    vi.clearAllMocks();
    setEntitlementFn(async () => ({ entitled: true }));
  });

  it('grants access when entitled', async () => {
    const event = await attemptAccess(tenantId, actorId, {
      memberId,
      location: 'main_door',
      deviceId: 'door-1',
    });
    expect(event.result).toBe('granted');
  });

  it('denies access when not entitled', async () => {
    setEntitlementFn(async () => ({
      entitled: false,
      reason: 'Membership frozen',
    }));
    const event = await attemptAccess(tenantId, actorId, {
      memberId,
      location: 'gym_floor',
    });
    expect(event.result).toBe('denied');
    expect(event.reason).toMatch(/frozen/i);
    const denials = await getDenialCount(
      tenantId,
      actorId,
      memberId,
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(denials.denials).toBe(1);
  });

  it('rejects unknown location', async () => {
    await expect(
      attemptAccess(tenantId, actorId, {
        memberId,
        location: 'roof',
      }),
    ).rejects.toThrow(/location/i);
    const list = await listAccessEvents(tenantId, actorId);
    expect(list).toHaveLength(0);
  });
});
