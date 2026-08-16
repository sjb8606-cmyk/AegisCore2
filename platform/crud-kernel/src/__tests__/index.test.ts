import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

import { runCrudOperation } from '../index';
import { loadConfig } from '@platform/utils';
import { emit as auditEmit } from '@platform/audit';
import { recordUsage } from '@platform/metering';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true });
});

describe('runCrudOperation — the mechanical wrapper only', () => {
  it('throws before running the action when the core is disabled in config', async () => {
    (loadConfig as any).mockReturnValue({ enabled: false });
    const action = vi.fn();

    await expect(
      runCrudOperation({
        configName: 'crm',
        configSchema: {} as any,
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        action,
        auditAction: 'crm.contact.created',
      }),
    ).rejects.toThrow('crm is disabled');

    expect(action).not.toHaveBeenCalled();
    expect(auditEmit).not.toHaveBeenCalled();
  });

  it('runs the real, core-specific action and returns its real result untouched', async () => {
    const action = vi.fn().mockResolvedValue({ id: 'contact-1', name: 'Real Data' });

    const result = await runCrudOperation({
      configName: 'crm',
      configSchema: {} as any,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      action,
      auditAction: 'crm.contact.created',
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'contact-1', name: 'Real Data' });
  });

  it('blocks the operation when the core-specific quota check throws, before the action ever runs', async () => {
    const action = vi.fn();
    const checkQuota = vi.fn().mockRejectedValue(new Error('Monthly contact quota reached'));

    await expect(
      runCrudOperation({
        configName: 'crm',
        configSchema: {} as any,
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        checkQuota,
        action,
        auditAction: 'crm.contact.created',
      }),
    ).rejects.toThrow('Monthly contact quota reached');

    expect(action).not.toHaveBeenCalled();
  });

  it('emits a real audit event with the correct tenant, actor, and action after the operation succeeds', async () => {
    const action = vi.fn().mockResolvedValue({ id: 'contact-1' });

    await runCrudOperation({
      configName: 'crm',
      configSchema: {} as any,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      action,
      auditAction: 'crm.contact.created',
      auditResource: 'contact',
      auditResourceId: 'contact-1',
    });

    expect(auditEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        actorType: 'user',
        action: 'crm.contact.created',
        outcome: 'success',
        resource: 'contact',
        resourceId: 'contact-1',
      }),
    );
  });

  it('meters usage only when meterEventType is explicitly provided — never by default', async () => {
    const action = vi.fn().mockResolvedValue({ id: 'x' });

    await runCrudOperation({
      configName: 'crm',
      configSchema: {} as any,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      action,
      auditAction: 'crm.contact.created',
    });

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('meters usage with the real event type when the operation is billable', async () => {
    const action = vi.fn().mockResolvedValue({ id: 'x' });

    await runCrudOperation({
      configName: 'ai-forecasting',
      configSchema: {} as any,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      action,
      auditAction: 'ai.forecast.run',
      meterEventType: 'api_call',
    });

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, eventType: 'api_call', quantity: 1 }),
    );
  });
});
