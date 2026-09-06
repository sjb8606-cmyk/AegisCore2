/**
 * @platform/timesheets
 * DEFECT: clockOut hardcodes elapsedMinutes = 540 (9h) instead of computing from clock_in_at.
 * Overtime math still uses that constant vs dailyOvertimeHours threshold.
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
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', CONFLICT: 'CONFLICT', NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import { clockIn, clockOut, getClockHistory, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const EMP = '22222222-2222-2222-2222-222222222222';
const EVENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('timesheets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('clockIn FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: {}, limits: {}, thresholds: { dailyOvertimeHours: 8 },
    }));
    await expect(clockIn(TENANT, EMP, {})).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('clockIn inserts active event', async () => {
    const row = { id: EVENT, employee_id: EMP, status: 'active' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await clockIn(TENANT, EMP, {
      projectId: '33333333-3333-3333-3333-333333333333',
      location: { lat: 40.7, lng: -74.0 },
      notes: 'Site A',
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO clock_events/i);
  });

  it('clockIn maps unique-constraint to CONFLICT', async () => {
    mockWithTenantQuery.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    await expect(clockIn(TENANT, EMP, {}))
      .rejects.toMatchObject({ code: ErrorCode.CONFLICT, message: expect.stringMatching(/Already clocked in/i) });
  });

  it('clockOut BAD_REQUEST when no active session', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(clockOut(TENANT, EMP))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/No active clock-in/i) });
  });

  it('clockOut uses hardcoded 540 minutes and computes overtime (DEFECT: ignores real elapsed time)', async () => {
    // dailyOvertimeHours default 8 → threshold 480; overtime = 540-480 = 60
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: EVENT, clock_in_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{
        id: EVENT, status: 'completed', duration_minutes: 540, overtime_minutes: 60,
      }]);
    const result = await clockOut(TENANT, EMP);
    expect(result.duration_minutes).toBe(540);
    expect(result.overtime_minutes).toBe(60);
    expect(mockWithTenantQuery.mock.calls[1][1][0]).toBe(540);
    expect(mockWithTenantQuery.mock.calls[1][1][1]).toBe(60);
  });

  it('getClockHistory returns ordered events', async () => {
    const rows = [{ id: EVENT, status: 'completed' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    expect(await getClockHistory(TENANT, EMP)).toEqual(rows);
  });
});
