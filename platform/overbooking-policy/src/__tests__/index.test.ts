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
      overbookPercentBps: 5000, // 50% for easy test math on small inventory
      defaultCompensationCents: 10000,
      walkReasonCodes: ['overbook', 'maintenance', 'vip_hold', 'other'],
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
  setCapacity,
  tryConfirmBooking,
  getAvailability,
  recordWalk,
  __resetOverbookingPolicyStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const roomTypeId = 'king';
const date = '2026-10-01';

describe('overbooking-policy', () => {
  beforeEach(() => {
    __resetOverbookingPolicyStore();
    vi.clearAllMocks();
  });

  it('confirms within physical + overbook allowance', async () => {
    // 2 physical, 50% overbook => max 3
    await setCapacity(tenantId, actorId, {
      roomTypeId,
      date,
      physicalRooms: 2,
    });
    const c1 = await tryConfirmBooking(tenantId, actorId, { roomTypeId, date });
    const c2 = await tryConfirmBooking(tenantId, actorId, { roomTypeId, date });
    const c3 = await tryConfirmBooking(tenantId, actorId, { roomTypeId, date });
    const c4 = await tryConfirmBooking(tenantId, actorId, { roomTypeId, date });
    expect(c1.confirmed).toBe(true);
    expect(c2.confirmed).toBe(true);
    expect(c3.confirmed).toBe(true);
    expect(c4.confirmed).toBe(false);
  });

  it('reports remaining availability', async () => {
    await setCapacity(tenantId, actorId, {
      roomTypeId,
      date,
      physicalRooms: 2,
      confirmed: 1,
    });
    const avail = await getAvailability(tenantId, actorId, roomTypeId, date);
    expect(avail.remaining).toBe(2); // max 3 - 1
  });

  it('records walk with compensation and frees slot', async () => {
    await setCapacity(tenantId, actorId, {
      roomTypeId,
      date,
      physicalRooms: 1,
      confirmed: 1,
    });
    const walk = await recordWalk(tenantId, actorId, {
      reservationId: crypto.randomUUID(),
      roomTypeId,
      date,
      reasonCode: 'overbook',
      compensationCents: 15000,
    });
    expect(walk.compensationCents).toBe(15000);
    const avail = await getAvailability(tenantId, actorId, roomTypeId, date);
    expect(avail.confirmed).toBe(0);
  });
});
