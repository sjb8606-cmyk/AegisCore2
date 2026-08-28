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
  __resetTowTruckTypeMatchingStore,
  createTruckMatch,
  determineTruckType,
  findAvailableTruck
} from '../index';

describe('tow-truck-type-matching', () => {
  beforeEach(() => {
    __resetTowTruckTypeMatchingStore();
  });

  it('matches vehicle and situation to the correct truck type', () => {
    expect(
      determineTruckType(
        'sedan',
        'standard_tow'
      )
    ).toBe('wheel_lift');

    expect(
      determineTruckType(
        'heavy_truck',
        'accident'
      )
    ).toBe('heavy_duty');

    expect(
      determineTruckType(
        'motorcycle',
        'standard_tow'
      )
    ).toBe('motorcycle_trailer');
  });

  it('creates a tenant-scoped truck match', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const match = await createTruckMatch(
      tenantId,
      actorId,
      'exotic',
      'accident',
      '123 Main Street'
    );

    expect(match.tenantId).toBe(tenantId);
    expect(match.requiredTruckType).toBe('flatbed');
  });

  it('rejects a blank dispatch location', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    await expect(
      createTruckMatch(
        tenantId,
        actorId,
        'suv',
        'flat_tire',
        '   '
      )
    ).rejects.toThrow();
  });
});
