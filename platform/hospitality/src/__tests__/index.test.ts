import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/utils', () => {
  const ErrorCode = { BAD_REQUEST: 'BAD_REQUEST', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND' };
  class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  }
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function parseUserId(userId: unknown): string {
    if (typeof userId === 'string' && UUID_REGEX.test(userId)) return userId;
    throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
  }
  return { AppError, ErrorCode, parseUserId };
});

import { withTenantQuery } from '@platform/tenancy';
import { createRoom, createReservation, getAvailableRooms, checkOut, ErrorCode } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ROOM_ID = '22222222-2222-2222-2222-222222222222';
const RESERVATION_ID = '33333333-3333-3333-3333-333333333333';
const STAFF_ID = '44444444-4444-4444-4444-444444444444';

function mockConfigFile(config: unknown) {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config) as unknown as Buffer);
}
function mockNoConfigFile() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hospitality: createRoom', () => {
  it('throws FORBIDDEN when the hospitality module is disabled', async () => {
    mockConfigFile({ enabled: false, tiers: {}, limits: { roomCount: 50 } });

    await expect(createRoom(TENANT_ID, { room_number: '101', type: 'standard', base_rate_cents: 10000 }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('success path: defaults capacity to 2 when not specified', async () => {
    mockNoConfigFile();
    vi.mocked(withTenantQuery).mockImplementation(async (_sql: string, params: any[]) => {
      const [id, tenantId, roomNumber, name, type, capacity, baseRate] = params;
      return [{ id, tenant_id: tenantId, room_number: roomNumber, name, type, capacity, base_rate_cents: baseRate }];
    });

    const result = await createRoom(TENANT_ID, { room_number: '101', type: 'standard', base_rate_cents: 10000 });

    expect(result.capacity).toBe(2);
    expect(result.base_rate_cents).toBe(10000);
  });
});

describe('hospitality: createReservation', () => {
  it('throws BAD_REQUEST when the room is already booked for an overlapping date range', async () => {
    vi.mocked(withTenantQuery).mockResolvedValueOnce([{ '?column?': 1 }]); // overlap query returns a row

    await expect(createReservation(TENANT_ID, {
      room_id: ROOM_ID, guest_name: 'Jane Doe', check_in_date: '2026-09-10', check_out_date: '2026-09-12', rate_cents: 15000,
    })).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('success path: computes nights and total_cents correctly, and formats the confirmation number', async () => {
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT 1 FROM reservations')) return []; // no overlap
      if (sql.includes('COUNT(*) as seq')) return [{ seq: '0' }];
      if (sql.includes('INSERT INTO reservations')) {
        const [id, , confirmationNumber, , , , , , nights, , rateCents, totalCents] = params;
        return [{ id, confirmation_number: confirmationNumber, nights, rate_cents: rateCents, total_cents: totalCents }];
      }
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    const result = await createReservation(TENANT_ID, {
      room_id: ROOM_ID, guest_name: 'Jane Doe', check_in_date: '2026-09-10', check_out_date: '2026-09-13', rate_cents: 15000,
    });

    expect(result.nights).toBe(3);
    expect(result.total_cents).toBe(45000);
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(result.confirmation_number).toBe(`HOS-${todayStr}-001`);
  });

  it('BUG: a reversed date range (checkout before checkin) is silently treated as 1 night instead of rejected', async () => {
    // Math.max(1, Math.ceil(...)) floors any non-positive duration up to 1
    // night rather than validating check_out_date > check_in_date. The real
    // fix: throw AppError(BAD_REQUEST) when the computed duration is <= 0.
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT 1 FROM reservations')) return [];
      if (sql.includes('COUNT(*) as seq')) return [{ seq: '0' }];
      if (sql.includes('INSERT INTO reservations')) {
        const [id, , confirmationNumber, , , , , , nights, , , totalCents] = params;
        return [{ id, confirmation_number: confirmationNumber, nights, total_cents: totalCents }];
      }
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    // check_out_date is BEFORE check_in_date — should arguably be invalid input.
    const result = await createReservation(TENANT_ID, {
      room_id: ROOM_ID, guest_name: 'Jane Doe', check_in_date: '2026-09-13', check_out_date: '2026-09-10', rate_cents: 15000,
    });

    expect(result.nights).toBe(1); // documents current (broken) behavior
    expect(result.total_cents).toBe(15000);
  });

  it('BUG: createReservation never calls loadConfig() — works even when the module is disabled', async () => {
    mockConfigFile({ enabled: false, tiers: {}, limits: { roomCount: 50 } });
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM reservations')) return [];
      if (sql.includes('COUNT(*) as seq')) return [{ seq: '0' }];
      if (sql.includes('INSERT INTO reservations')) return [{ id: RESERVATION_ID }];
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    await expect(createReservation(TENANT_ID, {
      room_id: ROOM_ID, guest_name: 'Jane Doe', check_in_date: '2026-09-10', check_out_date: '2026-09-12', rate_cents: 10000,
    })).resolves.toMatchObject({ id: RESERVATION_ID });
    // Config file was never even read for this function.
    expect(fs.existsSync).not.toHaveBeenCalled();
  });
});

describe('hospitality: getAvailableRooms', () => {
  it('returns rooms passed through from the availability query', async () => {
    const rows = [{ id: ROOM_ID, room_number: '101', capacity: 2 }];
    vi.mocked(withTenantQuery).mockResolvedValue(rows);

    const result = await getAvailableRooms(TENANT_ID, '2026-09-10', '2026-09-12', 2);

    expect(result).toEqual(rows);
  });
});

describe('hospitality: checkOut', () => {
  it('throws BAD_REQUEST for an invalid staffId', async () => {
    await expect(checkOut(TENANT_ID, RESERVATION_ID, 'not-a-uuid'))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws NOT_FOUND when the reservation does not exist', async () => {
    vi.mocked(withTenantQuery).mockResolvedValue([]);
    await expect(checkOut(TENANT_ID, RESERVATION_ID, STAFF_ID))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('success path: marks the room for cleaning and creates a housekeeping task', async () => {
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string) => {
      if (sql.includes("SET status = 'checked_out'")) return [{ room_id: ROOM_ID }];
      if (sql.includes("SET status = 'cleaning'")) return [];
      if (sql.includes('INSERT INTO housekeeping_tasks')) return [];
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    const result = await checkOut(TENANT_ID, RESERVATION_ID, STAFF_ID);

    expect(result.success).toBe(true);
    expect(result.roomId).toBe(ROOM_ID);
  });

  it('BUG: checkOut never calls loadConfig() — works even when the module is disabled', async () => {
    mockConfigFile({ enabled: false, tiers: {}, limits: { roomCount: 50 } });
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string) => {
      if (sql.includes("SET status = 'checked_out'")) return [{ room_id: ROOM_ID }];
      if (sql.includes("SET status = 'cleaning'")) return [];
      if (sql.includes('INSERT INTO housekeeping_tasks')) return [];
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    await expect(checkOut(TENANT_ID, RESERVATION_ID, STAFF_ID)).resolves.toMatchObject({ success: true });
    expect(fs.existsSync).not.toHaveBeenCalled();
  });
});
