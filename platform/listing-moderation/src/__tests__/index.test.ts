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
      requireApprovalBeforePublic: true,
      flagReasons: [
        'prohibited_item',
        'misleading',
        'copyright',
        'spam',
        'other',
      ],
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
  submitListing,
  approveListing,
  rejectListing,
  takedownListing,
  assertListingPublic,
  flagListing,
  listPendingReview,
  __resetListingModerationStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('listing-moderation', () => {
  beforeEach(() => {
    __resetListingModerationStore();
    vi.clearAllMocks();
  });

  it('submits to pending and blocks public until approved', async () => {
    const listing = await submitListing(tenantId, actorId, {
      sellerId: 'seller-1',
      title: 'Kayak',
    });
    expect(listing.status).toBe('pending_review');
    await expect(assertListingPublic(tenantId, listing.id)).rejects.toThrow(
      /not public/i,
    );
    const pending = await listPendingReview(tenantId, actorId);
    expect(pending).toHaveLength(1);
  });

  it('approves then allows public', async () => {
    const listing = await submitListing(tenantId, actorId, {
      sellerId: 's1',
      title: 'Paddle',
    });
    await approveListing(tenantId, actorId, listing.id);
    const gate = await assertListingPublic(tenantId, listing.id);
    expect(gate.public).toBe(true);
  });

  it('rejects, flags, and takes down', async () => {
    const listing = await submitListing(tenantId, actorId, {
      sellerId: 's2',
      title: 'Bad item',
    });
    await flagListing(tenantId, actorId, listing.id, 'spam');
    const rejected = await rejectListing(
      tenantId,
      actorId,
      listing.id,
      'Spam listing',
    );
    expect(rejected.status).toBe('rejected');
    await approveListing(tenantId, actorId, listing.id);
    const down = await takedownListing(
      tenantId,
      actorId,
      listing.id,
      'Policy violation',
    );
    expect(down.status).toBe('taken_down');
  });
});
