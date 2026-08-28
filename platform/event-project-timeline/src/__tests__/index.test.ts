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
        vendorTracking: true,
        deadlineTracking: true,
      },
    }),
  };
});

import {
  createEvent,
  addVendor,
  updateVendorStatus,
  getUpcomingDeadlines,
  __resetEventProjectTimelineStore,
} from '../index';

describe('event-project-timeline', () => {
  beforeEach(() => {
    __resetEventProjectTimelineStore();
  });

  it('creates an event and adds a vendor', async () => {
    const event = await createEvent(
      'tenant-1',
      'actor-1',
      'client-1',
      '2026-10-15',
    );

    const updated = await addVendor(
      'tenant-1',
      'actor-1',
      event.eventId,
      {
        vendorName: 'Main Catering',
        vendorRole: 'Caterer',
        deadline: '2026-10-01',
        status: 'pending',
      },
    );

    expect(updated.vendors).toHaveLength(1);
    expect(updated.vendors[0].vendorName).toBe('Main Catering');
  });

  it('rejects duplicate vendors for the same event', async () => {
    const event = await createEvent(
      'tenant-1',
      'actor-1',
      'client-1',
      '2026-10-15',
    );

    const vendor = {
      vendorName: 'Main Catering',
      vendorRole: 'Caterer',
      deadline: '2026-10-01',
      status: 'pending' as const,
    };

    await addVendor('tenant-1', 'actor-1', event.eventId, vendor);

    await expect(
      addVendor('tenant-1', 'actor-1', event.eventId, vendor),
    ).rejects.toThrow('Vendor already exists');
  });

  it('updates vendor status and returns upcoming deadlines in order', async () => {
    const event = await createEvent(
      'tenant-1',
      'actor-1',
      'client-1',
      '2026-10-15',
    );

    await addVendor('tenant-1', 'actor-1', event.eventId, {
      vendorName: 'Florist',
      vendorRole: 'Florist',
      deadline: '2026-10-05',
      status: 'pending',
    });

    await addVendor('tenant-1', 'actor-1', event.eventId, {
      vendorName: 'Caterer',
      vendorRole: 'Caterer',
      deadline: '2026-10-01',
      status: 'pending',
    });

    await updateVendorStatus(
      'tenant-1',
      'actor-1',
      event.eventId,
      'Caterer',
      'confirmed',
    );

    const deadlines = await getUpcomingDeadlines(
      'tenant-1',
      'actor-1',
      event.eventId,
    );

    expect(deadlines[0].vendorName).toBe('Caterer');
    expect(deadlines[0].status).toBe('confirmed');
    expect(deadlines[1].vendorName).toBe('Florist');
  });
});
