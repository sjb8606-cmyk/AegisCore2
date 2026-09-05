/**
 * @platform/transport — matches real createRoute/createTrip/bookSeat/updateTripStatus
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN',
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import {
  validateTransition,
  createRoute,
  createTrip,
  bookSeat,
  updateTripStatus,
  getTripLedger,
  AppError,
  ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ROUTE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TRIP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('transport', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockExistsSync.mockReturnValue(false); // use built-in defaults (enabled: true)
  });

  it('validateTransition allows scheduled -> boarding', () => {
    expect(() => validateTransition('scheduled', 'boarding')).not.toThrow();
  });

  it('validateTransition rejects completed -> boarding', () => {
    expect(() => validateTransition('completed', 'boarding')).toThrow(/Invalid state transition/);
  });

  it('createRoute FORBIDDEN when disabled', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: false, tiers: {}, limits: {}, thresholds: {} }),
    );
    await expect(
      createRoute(TENANT, { name: 'Airport', origin: 'A', destination: 'B', distance_km: 12 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createRoute inserts route', async () => {
    const row = { id: ROUTE, name: 'Airport Express' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(
      await createRoute(TENANT, {
        name: 'Airport Express',
        origin: 'Downtown',
        destination: 'Airport',
        distance_km: 18,
      }),
    ).toEqual(row);
  });

  it('createTrip inserts with status scheduled', async () => {
    const row = {
      id: TRIP,
      route_id: ROUTE,
      status: 'scheduled',
      capacity: 40,
    };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(
      await createTrip(TENANT, {
        route_id: ROUTE,
        scheduled_time: '2026-06-01T10:00:00Z',
        capacity: 40,
      }),
    ).toEqual(row);
  });

  it('bookSeat NOT_FOUND when trip missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(
      bookSeat(TENANT, { trip_id: TRIP, passenger_name: 'Ada' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('bookSeat BAD_REQUEST when over capacity', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: TRIP, capacity: '10', booked_seats: '11' }, // 11 >= floor(10*1.05)=10
    ]);
    await expect(
      bookSeat(TENANT, { trip_id: TRIP, passenger_name: 'Ada' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('bookSeat inserts booking and increments seats', async () => {
    const booking = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      passenger_name: 'Ada',
      status: 'booked',
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: TRIP, capacity: '40', booked_seats: '5' }])
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([]);

    expect(
      await bookSeat(TENANT, { trip_id: TRIP, passenger_name: 'Ada' }),
    ).toEqual(booking);
  });

  it('updateTripStatus applies valid transition', async () => {
    const updated = { id: TRIP, status: 'boarding' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ status: 'scheduled' }])
      .mockResolvedValueOnce([updated]);
    expect(await updateTripStatus(TENANT, TRIP, 'boarding')).toEqual(updated);
  });

  it('getTripLedger nests bookings', async () => {
    const trip = { id: TRIP, route_name: 'Airport Express' };
    const bookings = [{ passenger_name: 'Ada' }];
    mockWithTenantQuery.mockResolvedValueOnce([trip]).mockResolvedValueOnce(bookings);
    const result = await getTripLedger(TENANT, TRIP);
    expect(result.bookings).toEqual(bookings);
  });
});
