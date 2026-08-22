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
      indexedEntityTypes: ['*'],
      defaultRadiusKm: 25,
      maxRadiusKm: 500,
      maxResults: 50,
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
  upsertLocation,
  nearby,
  haversineKm,
  __resetGeoNearbyStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('geo-nearby', () => {
  beforeEach(() => {
    __resetGeoNearbyStore();
    vi.clearAllMocks();
  });

  it('haversine is \~0 for same point', () => {
    expect(haversineKm(45.27, -66.06, 45.27, -66.06)).toBe(0);
  });

  it('finds nearby stores sorted by distance', async () => {
    // Saint John NB-ish
    await upsertLocation(tenantId, actorId, {
      entityType: 'store',
      entityId: 's1',
      lat: 45.2733,
      lon: -66.0633,
      metadata: { name: 'Centre' },
    });
    await upsertLocation(tenantId, actorId, {
      entityType: 'store',
      entityId: 's2',
      lat: 45.3,
      lon: -66.1,
      metadata: { name: 'West' },
    });
    // Far away
    await upsertLocation(tenantId, actorId, {
      entityType: 'store',
      entityId: 's3',
      lat: 43.65,
      lon: -79.38,
      metadata: { name: 'Toronto' },
    });

    const results = await nearby(tenantId, actorId, {
      lat: 45.2733,
      lon: -66.0633,
      radiusKm: 20,
      entityType: 'store',
    });
    expect(results.length).toBe(2);
    expect(results[0].entityId).toBe('s1');
    expect(results[0].distanceKm).toBe(0);
    expect(results[1].distanceKm).toBeGreaterThan(0);
  });

  it('rejects invalid coordinates', async () => {
    await expect(
      upsertLocation(tenantId, actorId, {
        entityType: 'site',
        entityId: 'x',
        lat: 999,
        lon: 0,
      }),
    ).rejects.toThrow(/invalid/i);
  });
});
