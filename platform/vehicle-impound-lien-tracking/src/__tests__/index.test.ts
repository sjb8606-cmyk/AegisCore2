import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

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
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetVehicleImpoundLienTrackingStore,
  checkReleaseEligibility,
  fileLien,
  logImpound,
  releaseVehicle
} from '../index';

describe('vehicle-impound-lien-tracking', () => {
  beforeEach(() => {
    __resetVehicleImpoundLienTrackingStore();
  });

  it('logs an impound and files a lien', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const impound = await logImpound(
      tenantId,
      actorId,
      '1HGCM82633A004352',
      'non_payment',
      'ABC123'
    );

    expect(impound.status).toBe('held');

    const updated = await fileLien(
      tenantId,
      actorId,
      impound.impoundId,
      new Date().toISOString()
    );

    expect(updated.lienFiledDate).toBeDefined();
  });

  it('does not allow release before eligibility date', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const impound = await logImpound(
      tenantId,
      actorId,
      '1HGCM82633A004353',
      'accident'
    );

    expect(
      await checkReleaseEligibility(
        tenantId,
        actorId,
        impound.impoundId
      )
    ).toBe(false);

    await expect(
      releaseVehicle(
        tenantId,
        actorId,
        impound.impoundId,
        'Vehicle owner'
      )
    ).rejects.toThrow();
  });

  it('enforces tenant isolation', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const impound = await logImpound(
      tenantId,
      actorId,
      '1HGCM82633A004354',
      'abandoned'
    );

    await expect(
      checkReleaseEligibility(
        crypto.randomUUID(),
        actorId,
        impound.impoundId
      )
    ).rejects.toThrow();
  });
});
