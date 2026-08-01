import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return { ...actual, loadConfig: vi.fn() };
});
vi.mock('../../../../notifications/src/index', () => ({
  NotificationService: { send: vi.fn() },
}));

import { ShiftHuddleService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { NotificationService } from '../../../../notifications/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SHIFT_ID = '99999999-9999-9999-9999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, handoffRecipient: 'floor-supervisor@example.com' });
  (NotificationService.send as any).mockResolvedValue({ success: true, logId: 'log-1' });
});

describe('ShiftHuddleService.startShift', () => {
  const validInput = { shiftDate: '2026-07-15T00:00:00.000Z', shiftType: 'morning' as const, staffCount: 12 };

  it('creates a real open shift', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: SHIFT_ID, status: 'open' }]);

    const result = await ShiftHuddleService.startShift(TENANT_ID, USER_ID, validInput);
    expect(result.status).toBe('open');
  });

  it('throws CONFLICT when an open shift already exists for that date + type', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'existing-shift' }]);

    await expect(
      ShiftHuddleService.startShift(TENANT_ID, USER_ID, validInput)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});

describe('ShiftHuddleService.endShift', () => {
  it('closes the shift and sends a real handoff notification', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SHIFT_ID, status: 'open', shift_type: 'morning', shift_date: '2026-07-15' }])
      .mockResolvedValueOnce([{ id: SHIFT_ID, status: 'closed' }]);

    const result = await ShiftHuddleService.endShift(TENANT_ID, SHIFT_ID, USER_ID, {
      handoffNotes: 'Line 2 needs maintenance before next shift.',
      safetyIncidents: 0,
    });

    expect(result.status).toBe('closed');
    expect(NotificationService.send).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        recipient: 'floor-supervisor@example.com',
        body: expect.stringContaining('Line 2 needs maintenance'),
      })
    );
  });

  it('flags safety incidents in the notification subject', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SHIFT_ID, status: 'open', shift_type: 'night', shift_date: '2026-07-15' }])
      .mockResolvedValueOnce([{ id: SHIFT_ID, status: 'closed' }]);

    await ShiftHuddleService.endShift(TENANT_ID, SHIFT_ID, USER_ID, {
      handoffNotes: 'Minor slip near freezer entrance, cleaned up.',
      safetyIncidents: 1,
    });

    const sendCall = (NotificationService.send as any).mock.calls[0][1];
    expect(sendCall.subject).toContain('SAFETY INCIDENT REPORTED');
  });

  it('throws CONFLICT when the shift is already closed', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SHIFT_ID, status: 'closed' }]);

    await expect(
      ShiftHuddleService.endShift(TENANT_ID, SHIFT_ID, USER_ID, { handoffNotes: 'x', safetyIncidents: 0 })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(NotificationService.send).not.toHaveBeenCalled();
  });
});

describe('ShiftHuddleService.getActiveShift', () => {
  it('returns null (not a throw) when no open shift exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const result = await ShiftHuddleService.getActiveShift(TENANT_ID, 'morning');
    expect(result).toBeNull();
  });

  it('returns the real open shift when one exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SHIFT_ID, status: 'open' }]);

    const result = await ShiftHuddleService.getActiveShift(TENANT_ID, 'morning');
    expect(result?.id).toBe(SHIFT_ID);
  });
});

describe('ShiftHuddleService.getShift', () => {
  it('throws NOT_FOUND for a nonexistent shift', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      ShiftHuddleService.getShift(TENANT_ID, SHIFT_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('ShiftHuddleService.listShifts', () => {
  it('applies shiftType and status filters', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await ShiftHuddleService.listShifts(TENANT_ID, { shiftType: 'morning', status: 'closed' });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('shift_type = $2');
    expect(call[0]).toContain('status = $3');
  });
});
