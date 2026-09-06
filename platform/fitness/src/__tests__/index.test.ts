/**
 * @platform/fitness
 * Capacity → waitlist when tier on; check-in requires booked status.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createMember, createClass, bookClass, registerCheckIn, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const MEMBER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('fitness', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createMember inserts member', async () => {
    const row = { id: MEMBER, name: 'Ada', email: 'ada@example.com' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await createMember(TENANT, { name: 'Ada', email: 'ada@example.com' })).toEqual(row);
  });

  it('createClass inserts class', async () => {
    const row = { id: CLASS, name: 'Yoga', capacity: 10 };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    expect(await createClass(TENANT, {
      name: 'Yoga', trainer_name: 'Sam', capacity: 10, scheduled_at: '2026-06-01T10:00:00Z',
    })).toEqual(row);
  });

  it('bookClass NOT_FOUND when class missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(bookClass(TENANT, { class_id: CLASS, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('bookClass books when under capacity', async () => {
    const booking = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', status: 'booked' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: CLASS, capacity: '10' }])
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([booking]);
    const result = await bookClass(TENANT, { class_id: CLASS, member_id: MEMBER });
    expect(result.status).toBe('booked');
  });

  it('bookClass waitlists when full and waitlists tier on', async () => {
    const booking = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', status: 'waitlisted' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: CLASS, capacity: '5' }])
      .mockResolvedValueOnce([{ count: '5' }])
      .mockResolvedValueOnce([booking]);
    const result = await bookClass(TENANT, { class_id: CLASS, member_id: MEMBER });
    expect(result.status).toBe('waitlisted');
  });

  it('bookClass BAD_REQUEST when full and waitlists off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { waitlists: false },
      limits: {},
      thresholds: {},
    }));
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: CLASS, capacity: '5' }])
      .mockResolvedValueOnce([{ count: '5' }]);
    await expect(bookClass(TENANT, { class_id: CLASS, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/maximum capacity/i) });
  });

  it('registerCheckIn requires booked status', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(registerCheckIn(TENANT, { class_id: CLASS, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/No active class booking/i) });
  });

  it('registerCheckIn inserts check-in when booked', async () => {
    const checkIn = { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: 'booking-1', status: 'booked' }])
      .mockResolvedValueOnce([]) // no existing check-in
      .mockResolvedValueOnce([checkIn]);
    const result = await registerCheckIn(TENANT, { class_id: CLASS, member_id: MEMBER });
    expect(result).toEqual(checkIn);
  });
});
