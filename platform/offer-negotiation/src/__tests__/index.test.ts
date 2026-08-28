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
      defaultTtlHours: 48,
      maxCounters: 5,
      minOfferBpsOfList: 5000,
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
  makeOffer,
  counterOffer,
  acceptOffer,
  declineOffer,
  listOffersForListing,
  __resetOfferNegotiationStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const listingId = 'listing-1';

describe('offer-negotiation', () => {
  beforeEach(() => {
    __resetOfferNegotiationStore();
    vi.clearAllMocks();
  });

  it('makes offer and accepts', async () => {
    const offer = await makeOffer(tenantId, actorId, {
      listingId,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listPriceCents: 10000,
      amountCents: 8000,
    });
    expect(offer.status).toBe('pending');
    const accepted = await acceptOffer(tenantId, actorId, offer.id);
    expect(accepted.status).toBe('accepted');
  });

  it('counters and declines', async () => {
    const offer = await makeOffer(tenantId, actorId, {
      listingId,
      buyerId: 'b2',
      sellerId: 's2',
      listPriceCents: 10000,
      amountCents: 7000,
    });
    const countered = await counterOffer(tenantId, actorId, offer.id, 8500);
    expect(countered.status).toBe('countered');
    expect(countered.amountCents).toBe(8500);
    const declined = await declineOffer(tenantId, actorId, offer.id);
    expect(declined.status).toBe('declined');
  });

  it('rejects offer below min percent of list', async () => {
    await expect(
      makeOffer(tenantId, actorId, {
        listingId,
        buyerId: 'b3',
        sellerId: 's3',
        listPriceCents: 10000,
        amountCents: 1000, // 10% < 50% min
      }),
    ).rejects.toThrow(/minimum/i);
    const list = await listOffersForListing(tenantId, actorId, listingId);
    expect(list).toHaveLength(0);
  });
});
