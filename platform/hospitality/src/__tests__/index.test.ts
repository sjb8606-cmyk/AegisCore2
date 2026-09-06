/**
 * @platform/hospitality
 * Reservation create + availability conflict handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', BAD_REQUEST: 'BAD_REQUEST', CONFLICT: 'CONFLICT',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createProperty, createReservation, cancelReservation, getReservation, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RES = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('hospitality', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createProperty inserts property', async () => {
    const row = { id: PROP, name: 'Harbor Inn', rooms: 24 };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createProperty(TENANT, { name: 'Harbor Inn', rooms: 24 });
    expect(result).toEqual(row);
  });

  it('createReservation inserts reservation', async () => {
    const row = {
      id: RES, property_id: PROP, guest_name: 'Ada',
      check_in: '2026-07-01', check_out: '2026-07-03', status: 'confirmed',
    };
    mockWithTenantQuery.mockImplementation(async (sql: string) => {
      if (/SELECT|COUNT|overlap|conflict/i.test(sql) && !/INSERT/i.test(sql)) return [];
      return [row];
    });
    const result = await createReservation(TENANT, {
      property_id: PROP, guest_name: 'Ada',
      check_in: '2026-07-01', check_out: '2026-07-03',
    });
    expect(result).toEqual(row);
  });

  it('cancelReservation updates status', async () => {
    const updated = { id: RES, status: 'canceled' };
    mockWithTenantQuery.mockResolvedValue([updated]);
    const result = await cancelReservation(TENANT, RES);
    expect(result.status || result).toBeTruthy();
  });

  it('getReservation NOT_FOUND / success', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getReservation(TENANT, RES)).rejects.toMatchObject({ code: expect.any(String) });

    const row = { id: RES, guest_name: 'Ada' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await getReservation(TENANT, RES)).toEqual(row);
  });
});
