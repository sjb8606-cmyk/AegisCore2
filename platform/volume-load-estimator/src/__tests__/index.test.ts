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
  __resetVolumeLoadEstimatorStore,
  calculatePriceVariance,
  confirmFinalVolume,
  estimateFromPhotos
} from '../index';

describe('volume-load-estimator', () => {
  beforeEach(() => {
    __resetVolumeLoadEstimatorStore();
  });

  it('creates an estimate and confirms final volume', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const estimate = await estimateFromPhotos(
      tenantId,
      actorId,
      requestId,
      ['photo-before-1.jpg']
    );

    expect(
      estimate.estimatedCubicYards
    ).toBe(1);

    const updated =
      await confirmFinalVolume(
        tenantId,
        actorId,
        estimate.estimateId,
        3.5
      );

    expect(
      updated.finalCubicYards
    ).toBe(3.5);

    expect(
      await calculatePriceVariance(
        tenantId,
        actorId,
        estimate.estimateId
      )
    ).toBe(2.5);
  });

  it('rejects an estimate without photos', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    await expect(
      estimateFromPhotos(
        tenantId,
        actorId,
        requestId,
        []
      )
    ).rejects.toThrow();
  });

  it('enforces tenant isolation when confirming volume', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const estimate = await estimateFromPhotos(
      tenantId,
      actorId,
      requestId,
      ['photo.jpg']
    );

    await expect(
      confirmFinalVolume(
        crypto.randomUUID(),
        actorId,
        estimate.estimateId,
        2
      )
    ).rejects.toThrow();
  });
});
