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
  __resetChemicalMixSurfaceCalculatorStore,
  calculateDilution,
  estimateChemicalCost
} from '../index';

describe('chemical-mix-surface-calculator', () => {
  beforeEach(() => {
    __resetChemicalMixSurfaceCalculatorStore();
  });

  it('calculates dilution and estimated chemical quantity', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    const calculation =
      await calculateDilution(
        tenantId,
        actorId,
        propertyId,
        'concrete',
        'cleaning_solution',
        500
      );

    expect(
      calculation.dilutionRatio
    ).toBe('1:10');

    expect(
      calculation.estimatedChemicalNeededGallons
    ).toBe(5);
  });

  it('rejects a non-positive area', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    await expect(
      calculateDilution(
        tenantId,
        actorId,
        propertyId,
        'vinyl_siding',
        'cleaner',
        0
      )
    ).rejects.toThrow();
  });

  it('enforces tenant isolation for cost calculation', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    const calculation =
      await calculateDilution(
        tenantId,
        actorId,
        propertyId,
        'brick',
        'cleaner',
        300
      );

    await expect(
      estimateChemicalCost(
        crypto.randomUUID(),
        actorId,
        calculation.calculationId,
        4
      )
    ).rejects.toThrow();
  });
});
