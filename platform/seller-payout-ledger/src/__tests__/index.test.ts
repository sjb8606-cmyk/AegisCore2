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
      platformFeeBps: 1000,
      holdDays: 0, // immediate release for tests
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
  recordSale,
  releaseHolds,
  createPayout,
  getSellerBalance,
  __resetSellerPayoutStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const sellerId = 'seller-1';

describe('seller-payout-ledger', () => {
  beforeEach(() => {
    __resetSellerPayoutStore();
    vi.clearAllMocks();
  });

  it('records sale with 10% fee into pending', async () => {
    const result = await recordSale(tenantId, actorId, {
      sellerId,
      orderId: crypto.randomUUID(),
      grossCents: 10000,
    });
    expect(result.feeCents).toBe(1000);
    expect(result.netCents).toBe(9000);
    expect(result.balance.pendingCents).toBe(9000);
  });

  it('releases holds then pays out', async () => {
    await recordSale(tenantId, actorId, {
      sellerId,
      orderId: crypto.randomUUID(),
      grossCents: 5000,
    });
    const released = await releaseHolds(tenantId, actorId, sellerId);
    expect(released.releasedCents).toBe(4500);
    const bal = await getSellerBalance(tenantId, actorId, sellerId);
    expect(bal.availableCents).toBe(4500);
    const payout = await createPayout(tenantId, actorId, sellerId);
    expect(payout.amountCents).toBe(4500);
    const after = await getSellerBalance(tenantId, actorId, sellerId);
    expect(after.availableCents).toBe(0);
    expect(after.paidCents).toBe(4500);
  });

  it('rejects payout over available', async () => {
    await expect(
      createPayout(tenantId, actorId, sellerId, 100),
    ).rejects.toThrow(/nothing available|exceeds available/i);
  });
});
