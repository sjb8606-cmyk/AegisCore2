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
      defaultTrainerPayoutCents: 3000,
      allowOverdraw: false,
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
  purchasePackage,
  burnSession,
  getTrainerPayoutSummary,
  getPackageBalance,
  __resetTrainerSessionStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const memberId = 'member-1';
const trainerId = 'trainer-1';

describe('trainer-session-ledger', () => {
  beforeEach(() => {
    __resetTrainerSessionStore();
    vi.clearAllMocks();
  });

  it('purchases package and burns sessions', async () => {
    const pkg = await purchasePackage(tenantId, actorId, {
      memberId,
      trainerId,
      totalSessions: 5,
      purchaseCents: 50000,
      trainerPayoutCentsPerSession: 4000,
    });
    expect(pkg.remainingSessions).toBe(5);
    const { package: after } = await burnSession(tenantId, actorId, {
      packageId: pkg.id,
    });
    expect(after.remainingSessions).toBe(4);
  });

  it('blocks burn when empty', async () => {
    const pkg = await purchasePackage(tenantId, actorId, {
      memberId,
      trainerId,
      totalSessions: 1,
      purchaseCents: 10000,
    });
    await burnSession(tenantId, actorId, { packageId: pkg.id });
    await expect(
      burnSession(tenantId, actorId, { packageId: pkg.id }),
    ).rejects.toThrow(/remaining/i);
    const bal = await getPackageBalance(tenantId, actorId, pkg.id);
    expect(bal.active).toBe(false);
  });

  it('summarizes trainer payouts', async () => {
    const pkg = await purchasePackage(tenantId, actorId, {
      memberId,
      trainerId,
      totalSessions: 3,
      purchaseCents: 30000,
      trainerPayoutCentsPerSession: 2500,
    });
    await burnSession(tenantId, actorId, { packageId: pkg.id });
    await burnSession(tenantId, actorId, { packageId: pkg.id });
    const summary = await getTrainerPayoutSummary(
      tenantId,
      actorId,
      trainerId,
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(summary.sessions).toBe(2);
    expect(summary.payoutCents).toBe(5000);
  });
});
