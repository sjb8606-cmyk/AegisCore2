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
      defaultBeforeMinutes: 5,
      defaultAfterMinutes: 10,
      defaultTravelMinutes: 0,
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
  setResourceBuffers,
  setTravelTime,
  computeEffectiveWindow,
  assertFitsWithBuffers,
  __resetBufferTravelStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const resourceId = 'staff-1';

describe('buffer-travel-rules', () => {
  beforeEach(() => {
    __resetBufferTravelStore();
    vi.clearAllMocks();
  });

  it('expands window with before/after buffers', async () => {
    await setResourceBuffers(tenantId, actorId, {
      resourceId,
      beforeMinutes: 15,
      afterMinutes: 15,
    });
    const start = new Date('2026-10-01T14:00:00Z').toISOString();
    const end = new Date('2026-10-01T15:00:00Z').toISOString();
    const win = await computeEffectiveWindow(tenantId, actorId, {
      resourceId,
      startAt: start,
      endAt: end,
    });
    expect(Date.parse(win.startAt)).toBe(Date.parse(start) - 15 * 60_000);
    expect(Date.parse(win.endAt)).toBe(Date.parse(end) + 15 * 60_000);
  });

  it('adds travel time between locations', async () => {
    await setTravelTime(tenantId, actorId, {
      fromLocationId: 'site-a',
      toLocationId: 'site-b',
      travelMinutes: 30,
    });
    const start = new Date('2026-10-01T16:00:00Z').toISOString();
    const end = new Date('2026-10-01T17:00:00Z').toISOString();
    const win = await computeEffectiveWindow(tenantId, actorId, {
      resourceId,
      startAt: start,
      endAt: end,
      previousLocationId: 'site-a',
      locationId: 'site-b',
    });
    // default before 5 + travel 30 = 35 min earlier
    expect(Date.parse(win.startAt)).toBe(Date.parse(start) - 35 * 60_000);
    expect(win.travelMinutes).toBe(30);
  });

  it('blocks when previous job overlaps expanded start', async () => {
    await setResourceBuffers(tenantId, actorId, {
      resourceId,
      beforeMinutes: 20,
      afterMinutes: 0,
    });
    await expect(
      assertFitsWithBuffers(tenantId, actorId, {
        resourceId,
        startAt: '2026-10-02T12:00:00Z',
        endAt: '2026-10-02T13:00:00Z',
        previousEndAt: '2026-10-02T11:50:00Z', // only 10 min gap, need 20
      }),
    ).rejects.toThrow(/does not fit/i);
  });
});
