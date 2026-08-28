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
      defaultMinStayNights: 1,
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
  setRestriction,
  validateStay,
  getRestrictions,
  __resetMinStayStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const roomTypeId = 'queen';

describe('min-stay-restrictions', () => {
  beforeEach(() => {
    __resetMinStayStore();
    vi.clearAllMocks();
  });

  it('enforces min stay on arrival date', async () => {
    await setRestriction(tenantId, actorId, {
      roomTypeId,
      date: '2026-12-24',
      minStayNights: 3,
    });
    await expect(
      validateStay(tenantId, actorId, {
        roomTypeId,
        checkIn: '2026-12-24',
        checkOut: '2026-12-25',
      }),
    ).rejects.toThrow(/min stay/i);

    const ok = await validateStay(tenantId, actorId, {
      roomTypeId,
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
    });
    expect(ok.allowed).toBe(true);
    expect(ok.nights).toBe(3);
  });

  it('blocks closed to arrival', async () => {
    await setRestriction(tenantId, actorId, {
      roomTypeId,
      date: '2026-11-01',
      closedToArrival: true,
    });
    await expect(
      validateStay(tenantId, actorId, {
        roomTypeId,
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
      }),
    ).rejects.toThrow(/closed to arrival/i);
  });

  it('blocks closed to departure and lists range', async () => {
    await setRestriction(tenantId, actorId, {
      roomTypeId,
      date: '2026-11-05',
      closedToDeparture: true,
    });
    await expect(
      validateStay(tenantId, actorId, {
        roomTypeId,
        checkIn: '2026-11-03',
        checkOut: '2026-11-05',
      }),
    ).rejects.toThrow(/closed to departure/i);
    const list = await getRestrictions(
      tenantId,
      actorId,
      roomTypeId,
      '2026-11-01',
      '2026-11-10',
    );
    expect(list).toHaveLength(1);
  });
});
