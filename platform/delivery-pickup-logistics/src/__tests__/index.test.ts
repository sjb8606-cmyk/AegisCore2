import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      limits: { apiCallsPerMonth: 10000 },
      features: {
        deliveryScheduling: true,
        pickupScheduling: true,
        transportFeeCalculation: true,
      },
    }),
  };
});

import {
  scheduleDelivery,
  schedulePickup,
  calculateTransportFee,
  __resetDeliveryPickupLogisticsStore,
} from '../index';

describe('delivery-pickup-logistics', () => {
  beforeEach(() => {
    __resetDeliveryPickupLogisticsStore();
  });

  it('schedules delivery and pickup for a reservation', async () => {
    const delivery = await scheduleDelivery(
      'tenant-1',
      'actor-1',
      'reservation-1',
      '123 Main Street',
      '2026-09-01',
      75,
    );

    const updated = await schedulePickup(
      'tenant-1',
      'actor-1',
      'reservation-1',
      '2026-09-05',
    );

    expect(delivery.status).toBe('scheduled');
    expect(updated.pickupDate).toBe('2026-09-05');
    expect(updated.transportFee).toBe(75);
  });

  it('rejects pickup before delivery', async () => {
    await scheduleDelivery(
      'tenant-1',
      'actor-1',
      'reservation-1',
      '123 Main Street',
      '2026-09-05',
    );

    await expect(
      schedulePickup(
        'tenant-1',
        'actor-1',
        'reservation-1',
        '2026-09-01',
      ),
    ).rejects.toThrow('pickupDate cannot be before deliveryDate');
  });

  it('calculates transport fee from distance', async () => {
    const fee = await calculateTransportFee(
      'tenant-1',
      'actor-1',
      25,
      3.5,
    );

    expect(fee).toBe(87.5);
  });
});
