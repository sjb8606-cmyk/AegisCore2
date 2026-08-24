import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateOverage,
  flagMaintenanceDue,
  logHours,
  __resetEngineHourUsageStore
} from '../index';

describe('engine-hour-usage-tracking', () => {
  beforeEach(() => {
    __resetEngineHourUsageStore();
  });

  it('logs engine hours and calculates overage', async () => {
    await logHours(
      'tenant-1',
      'actor-1',
      'asset-1',
      'reservation-1',
      100,
      115,
      10,
      25,
      150
    );

    const overage = await calculateOverage(
      'tenant-1',
      'actor-1',
      'reservation-1'
    );

    expect(overage).toBe(125);
  });

  it('rejects a return meter reading below pickup', async () => {
    await expect(
      logHours(
        'tenant-1',
        'actor-1',
        'asset-1',
        'reservation-1',
        100,
        90,
        10,
        25,
        150
      )
    ).rejects.toThrow('hoursAtReturn cannot be less than hoursAtPickup');
  });

  it('flags maintenance when the threshold is reached', async () => {
    await logHours(
      'tenant-1',
      'actor-1',
      'asset-1',
      'reservation-1',
      100,
      150,
      10,
      25,
      150
    );

    const due = await flagMaintenanceDue(
      'tenant-1',
      'actor-1',
      'asset-1'
    );

    expect(due).toBe(true);
  });
});
