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
      allowNegative: false,
      earningRules: { referral: 100, purchase: 10, signup: 50 },
      redemptionRate: 0.01,
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
  credit,
  debit,
  getBalance,
  getHistory,
  redeemValue,
  __resetPointsLedgerStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const userId = 'user-1';

describe('points-ledger', () => {
  beforeEach(() => {
    __resetPointsLedgerStore();
    vi.clearAllMocks();
  });

  it('credits via reason rule and tracks balance', async () => {
    await credit(tenantId, actorId, { userId, reason: 'signup' });
    await credit(tenantId, actorId, {
      userId,
      reason: 'referral',
      relatedId: 'ref-9',
    });
    const bal = await getBalance(tenantId, userId);
    expect(bal.balance).toBe(150);
    const hist = await getHistory(tenantId, userId);
    expect(hist).toHaveLength(2);
    expect(hist[1].balanceAfter).toBe(150);
  });

  it('debits and blocks overdraft', async () => {
    await credit(tenantId, actorId, { userId, points: 40, reason: 'bonus' });
    await debit(tenantId, actorId, {
      userId,
      points: 15,
      reason: 'redeem',
    });
    expect((await getBalance(tenantId, userId)).balance).toBe(25);
    await expect(
      debit(tenantId, actorId, { userId, points: 100, reason: 'redeem' }),
    ).rejects.toThrow(/Insufficient/i);
  });

  it('computes redemption value', async () => {
    await credit(tenantId, actorId, { userId, points: 200, reason: 'promo' });
    const v = await redeemValue(tenantId, userId);
    expect(v.currencyValue).toBe(2);
  });
});
