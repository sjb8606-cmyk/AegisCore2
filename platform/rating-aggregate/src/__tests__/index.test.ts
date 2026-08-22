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
      supportedEntityTypes: ['*'],
      onePerUser: true,
      minScore: 1,
      maxScore: 5,
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
  createRating,
  deleteRating,
  getAggregate,
  listRatings,
  __resetRatingAggregateStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('rating-aggregate', () => {
  beforeEach(() => {
    __resetRatingAggregateStore();
    vi.clearAllMocks();
  });

  it('averages scores and caches count', async () => {
    await createRating(tenantId, actorId, {
      entityType: 'vendor',
      entityId: 'v1',
      userId: 'u1',
      score: 5,
    });
    await createRating(tenantId, actorId, {
      entityType: 'vendor',
      entityId: 'v1',
      userId: 'u2',
      score: 3,
    });
    const agg = await getAggregate(tenantId, 'vendor', 'v1');
    expect(agg.ratingCount).toBe(2);
    expect(agg.averageRating).toBe(4);
  });

  it('enforces one rating per user', async () => {
    await createRating(tenantId, actorId, {
      entityType: 'product',
      entityId: 'p1',
      userId: 'u1',
      score: 4,
    });
    await expect(
      createRating(tenantId, actorId, {
        entityType: 'product',
        entityId: 'p1',
        userId: 'u1',
        score: 2,
      }),
    ).rejects.toThrow(/already rated/i);
  });

  it('recomputes after delete', async () => {
    const { rating } = await createRating(tenantId, actorId, {
      entityType: 'contractor',
      entityId: 'c1',
      userId: 'u1',
      score: 5,
    });
    await createRating(tenantId, actorId, {
      entityType: 'contractor',
      entityId: 'c1',
      userId: 'u2',
      score: 1,
    });
    const after = await deleteRating(tenantId, actorId, rating.id);
    expect(after.ratingCount).toBe(1);
    expect(after.averageRating).toBe(1);
    expect((await listRatings(tenantId, 'contractor', 'c1')).length).toBe(1);
  });
});
