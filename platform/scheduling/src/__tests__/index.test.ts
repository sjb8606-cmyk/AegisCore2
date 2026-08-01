import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulingService, ErrorCode } from '../index';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SERVICE_ID = '33333333-3333-3333-3333-333333333333';
const START_AT = '2026-08-01T10:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SchedulingService.createService', () => {
  it('creates a real service with the given name and duration', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { id: SERVICE_ID, name: 'Dock Unload Inspection', duration_minutes: 45 },
    ]);

    const result = await SchedulingService.createService(TENANT_ID, USER_ID, {
      name: 'Dock Unload Inspection',
      durationMinutes: 45,
    });

    expect(result.name).toBe('Dock Unload Inspection');
    expect(withTenantQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO scheduling_services'),
      [TENANT_ID, 'Dock Unload Inspection', 45],
      TENANT_ID
    );
  });

  it('throws BAD_REQUEST for an invalid userId', async () => {
    await expect(
      SchedulingService.createService(TENANT_ID, 'not-a-uuid', { name: 'x', durationMinutes: 30 })
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('SchedulingService.createAppointment', () => {
  it('throws NOT_FOUND when the service does not belong to the tenant (no fake service is ever created)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      SchedulingService.createAppointment(TENANT_ID, USER_ID, {
        serviceId: SERVICE_ID,
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        startAt: START_AT,
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const insertCalls = (withTenantQuery as any).mock.calls.filter((call: any[]) =>
      call[0].includes('INSERT INTO scheduling_services')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('throws a validation error when serviceId is missing entirely (serviceId is now required)', async () => {
    await expect(
      SchedulingService.createAppointment(TENANT_ID, USER_ID, {
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        startAt: START_AT,
      })
    ).rejects.toThrow();
  });

  it('succeeds when the service genuinely exists and the slot is free', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SERVICE_ID }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: 'appt-1', service_id: SERVICE_ID }]);

    const result = await SchedulingService.createAppointment(TENANT_ID, USER_ID, {
      serviceId: SERVICE_ID,
      clientName: 'Test Client',
      clientEmail: 'test@example.com',
      startAt: START_AT,
    });

    expect(result.service_id).toBe(SERVICE_ID);
  });

  it('still enforces the double-booking conflict check', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: SERVICE_ID }])
      .mockResolvedValueOnce([{ count: 1 }]);

    await expect(
      SchedulingService.createAppointment(TENANT_ID, USER_ID, {
        serviceId: SERVICE_ID,
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        startAt: START_AT,
      })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});

describe('regression guard', () => {
  it('setupMockService no longer exists on SchedulingService', () => {
    expect((SchedulingService as any).setupMockService).toBeUndefined();
  });
});
