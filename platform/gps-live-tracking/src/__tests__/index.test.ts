import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

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
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetGpsLiveTrackingStore,
  createTracking,
  getCustomerTrackingLink,
  recalculateEta,
  updateLocation
} from '../index';

describe('gps-live-tracking', () => {
  beforeEach(() => {
    __resetGpsLiveTrackingStore();
  });

  it('creates tracking and updates the driver location', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const driverId = crypto.randomUUID();

    const tracking = await createTracking(
      tenantId,
      actorId,
      jobId,
      driverId,
      46.0878,
      -64.7782,
      20
    );

    const updated = await updateLocation(
      tenantId,
      actorId,
      driverId,
      46.09,
      -64.78
    );

    expect(updated.trackingId).toBe(
      tracking.trackingId
    );
    expect(updated.currentLat).toBe(46.09);
    expect(updated.currentLng).toBe(-64.78);
  });

  it('recalculates ETA and produces a customer tracking link', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const tracking = await createTracking(
      tenantId,
      actorId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      45,
      -65,
      30
    );

    const updated = await recalculateEta(
      tenantId,
      actorId,
      tracking.trackingId,
      12
    );

    expect(updated.etaMinutesRemaining).toBe(12);

    const link = await getCustomerTrackingLink(
      tenantId,
      actorId,
      tracking.jobId
    );

    expect(link).toContain(
      tracking.trackingId
    );
  });

  it('rejects invalid GPS coordinates', async () => {
    await expect(
      createTracking(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        120,
        -65
      )
    ).rejects.toThrow();
  });
});
