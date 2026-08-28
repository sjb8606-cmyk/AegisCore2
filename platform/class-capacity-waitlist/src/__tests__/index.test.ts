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
      lateCancelHours: 2,
      autoPromoteFromWaitlist: true,
      defaultCapacity: 2,
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
  createClassSession,
  bookClass,
  cancelBooking,
  getClassRoster,
  __resetClassCapacityStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('class-capacity-waitlist', () => {
  beforeEach(() => {
    __resetClassCapacityStore();
    vi.clearAllMocks();
  });

  it('books until capacity then waitlists', async () => {
    const session = await createClassSession(tenantId, actorId, {
      name: 'Yoga',
      startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      capacity: 2,
    });
    const b1 = await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm1',
    });
    const b2 = await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm2',
    });
    const b3 = await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm3',
    });
    expect(b1.status).toBe('booked');
    expect(b2.status).toBe('booked');
    expect(b3.status).toBe('waitlisted');
    expect(b3.waitlistPosition).toBe(1);
  });

  it('promotes waitlist on cancel', async () => {
    const session = await createClassSession(tenantId, actorId, {
      name: 'Spin',
      startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      capacity: 1,
    });
    const booked = await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm1',
    });
    await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm2',
    });
    const result = await cancelBooking(tenantId, actorId, booked.id);
    expect(result.promoted?.memberId).toBe('m2');
    expect(result.promoted?.status).toBe('booked');
    const roster = await getClassRoster(tenantId, actorId, session.id);
    expect(roster.booked).toHaveLength(1);
    expect(roster.waitlist).toHaveLength(0);
  });

  it('marks late cancel when inside window', async () => {
    const session = await createClassSession(tenantId, actorId, {
      name: 'HIIT',
      startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      capacity: 5,
    });
    const booked = await bookClass(tenantId, actorId, {
      classId: session.id,
      memberId: 'm9',
    });
    const result = await cancelBooking(tenantId, actorId, booked.id);
    expect(result.booking.status).toBe('late_cancelled');
  });
});
