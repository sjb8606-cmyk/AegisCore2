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
  __resetPropertyMeasurementStore,
  addMeasurement,
  estimateFromSatellite,
  getMeasurements
} from '../index';

describe('property-measurement', () => {
  beforeEach(() => {
    __resetPropertyMeasurementStore();
  });

  it('adds and retrieves property measurements', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();

    const measurement = await addMeasurement(
      tenantId,
      actorId,
      propertyId,
      'lawn',
      4200,
      'on_site_measured',
      clientId
    );

    const measurements = await getMeasurements(
      tenantId,
      actorId,
      propertyId
    );

    expect(measurement.areaSqft).toBe(4200);
    expect(measurements).toHaveLength(1);
  });

  it('rejects non-positive area', async () => {
    await expect(
      addMeasurement(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'lawn',
        0,
        'manual',
        crypto.randomUUID()
      )
    ).rejects.toThrow();
  });

  it('keeps satellite estimation as an integration hook', async () => {
    await expect(
      estimateFromSatellite(
        crypto.randomUUID(),
        crypto.randomUUID(),
        '100 Main Street'
      )
    ).rejects.toThrow(
      'Satellite measurement integration is not configured'
    );
  });
});
