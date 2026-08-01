import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/src/index')>();
  return { ...actual, loadConfig: vi.fn() };
});
vi.mock('../../../species-registry/src/index', () => ({
  SpeciesRegistryService: { getSpecies: vi.fn() },
}));
vi.mock('../../../../notifications/src/index', () => ({
  NotificationService: { send: vi.fn() },
}));

import { LossAlertService, ErrorCode } from '../index';
import { withTenantQuery } from '../../../../tenancy/src/index';
import { loadConfig } from '../../../../utils/src/index';
import { SpeciesRegistryService } from '../../../species-registry/src/index';
import { NotificationService } from '../../../../notifications/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = '33333333-3333-3333-3333-333333333333';
const YIELD_RECORD_ID = '77777777-7777-7777-7777-777777777777';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, alertRecipient: 'plant-manager@example.com' });
  (SpeciesRegistryService.getSpecies as any).mockResolvedValue({
    id: SPECIES_ID, common_name: 'Atlantic Salmon',
  });
});

describe('LossAlertService.sendLossAlert', () => {
  const underperformingRecord = {
    id: YIELD_RECORD_ID, species_id: SPECIES_ID, batch_id: 'batch-1',
    actual_yield_percent: 50, baseline_yield_percent: 62, deviation_points: -12,
    is_underperforming: true,
  };

  it('sends a real notification and records the alert', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([underperformingRecord])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'alert-1', notification_success: true }]);

    (NotificationService.send as any).mockResolvedValue({ success: true, logId: 'log-1' });

    const result = await LossAlertService.sendLossAlert(TENANT_ID, YIELD_RECORD_ID, USER_ID);

    expect(result.notification_success).toBe(true);
    expect(NotificationService.send).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ recipient: 'plant-manager@example.com', channel: 'email' })
    );

    const sendCall = (NotificationService.send as any).mock.calls[0][1];
    expect(sendCall.body).toContain('Atlantic Salmon');
    expect(sendCall.body).toContain('50');
  });

  it('throws NOT_FOUND when the yield record does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await expect(
      LossAlertService.sendLossAlert(TENANT_ID, YIELD_RECORD_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('throws BAD_REQUEST when the record is not actually flagged as underperforming', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ ...underperformingRecord, is_underperforming: false }]);

    await expect(
      LossAlertService.sendLossAlert(TENANT_ID, YIELD_RECORD_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });

    expect(NotificationService.send).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when an alert has already been sent for this record', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([underperformingRecord])
      .mockResolvedValueOnce([{ id: 'existing-alert' }]);

    await expect(
      LossAlertService.sendLossAlert(TENANT_ID, YIELD_RECORD_ID, USER_ID)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(NotificationService.send).not.toHaveBeenCalled();
  });

  it('records a real failure rather than silently marking success when notification sending fails', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([underperformingRecord])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'alert-1', notification_success: false }]);

    (NotificationService.send as any).mockResolvedValue({ success: false, error: 'provider timeout' });

    const result = await LossAlertService.sendLossAlert(TENANT_ID, YIELD_RECORD_ID, USER_ID);
    expect(result.notification_success).toBe(false);

    const insertCall = (withTenantQuery as any).mock.calls[2];
    expect(insertCall[1][3]).toBe(false);
  });
});

describe('LossAlertService.listAlerts', () => {
  it('filters by speciesId', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await LossAlertService.listAlerts(TENANT_ID, { speciesId: SPECIES_ID });

    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain('species_id = $2');
    expect(call[1]).toEqual([TENANT_ID, SPECIES_ID]);
  });
});
