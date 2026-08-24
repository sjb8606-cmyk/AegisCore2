import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) => options.action()
  };
});

import {
  __resetWeatherTriggeredDispatchStore,
  createTrigger,
  checkThreshold,
  triggerDispatch,
  updateAccumulation
} from '../index';

describe('weather-triggered-dispatch', () => {
  beforeEach(() => {
    __resetWeatherTriggeredDispatchStore();
  });

  it('creates a trigger and detects the accumulation threshold', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    await createTrigger(
      tenantId,
      actorId,
      propertyId,
      6
    );

    expect(
      await checkThreshold(
        tenantId,
        actorId,
        propertyId,
        6
      )
    ).toBe(true);
  });

  it('rejects negative accumulation', async () => {
    await expect(
      createTrigger(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        -1
      )
    ).rejects.toThrow();
  });

  it('triggers dispatch only after the threshold is reached', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const trigger = await createTrigger(
      tenantId,
      actorId,
      crypto.randomUUID(),
      4
    );

    await expect(
      triggerDispatch(
        tenantId,
        actorId,
        trigger.triggerId
      )
    ).rejects.toThrow();

    await updateAccumulation(
      tenantId,
      actorId,
      trigger.triggerId,
      5
    );

    const updated = await triggerDispatch(
      tenantId,
      actorId,
      trigger.triggerId
    );

    expect(updated.triggered).toBe(true);
    expect(updated.triggeredAt).toBeTruthy();
  });
});
