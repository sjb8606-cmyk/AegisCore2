import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn(() => ({
    enabled: true,
    limits: {
      units_per_tenant: 10000
    }
    }))
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
  class TestAppError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    AppError: TestAppError,
    ErrorCode: {
      BAD_REQUEST: 'BAD_REQUEST',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT'
    },
    runCrudOperation: async (args: {
      action: () => Promise<unknown>;
    }) => args.action()
  };
});

import {
  __resetStorageUnitInventoryLeasingStore,
  registerStorageUnit,
  getAvailableUnits,
  createLease,
  endLease
} from '../index';

describe('storage-unit-inventory-leasing', () => {
  beforeEach(() => {
    __resetStorageUnitInventoryLeasingStore();
  });

  it('registers a unit and returns it as available', async () => {
    const unit = await registerStorageUnit(
      'tenant-1',
      'actor-1',
      'facility-1',
      'small',
      125
    );

    expect(unit.status).toBe('available');
    expect(unit.facility_id).toBe('facility-1');

    const available = await getAvailableUnits(
      'tenant-1',
      'facility-1',
      'small'
    );

    expect(available).toHaveLength(1);
  });

  it('creates a lease and removes the unit from available inventory', async () => {
    const unit = await registerStorageUnit(
      'tenant-1',
      'actor-1',
      'facility-1',
      'medium',
      175
    );

    const leased = await createLease(
      'tenant-1',
      'actor-1',
      unit.unit_id,
      'customer-1',
      '2026-08-23'
    );

    expect(leased.status).toBe('occupied');
    expect(leased.tenant_id_holder).toBe('customer-1');

    const available = await getAvailableUnits(
      'tenant-1',
      'facility-1'
    );

    expect(available).toHaveLength(0);
  });

  it('ends an active lease and makes the unit available again', async () => {
    const unit = await registerStorageUnit(
      'tenant-1',
      'actor-1',
      'facility-1',
      'large',
      225
    );

    await createLease(
      'tenant-1',
      'actor-1',
      unit.unit_id,
      'customer-1',
      '2026-08-23'
    );

    const released = await endLease(
      'tenant-1',
      'actor-1',
      unit.unit_id,
      '2026-09-23'
    );

    expect(released.status).toBe('available');
    expect(released.tenant_id_holder).toBeUndefined();

    const available = await getAvailableUnits(
      'tenant-1',
      'facility-1',
      'large'
    );

    expect(available).toHaveLength(1);
  });
});
