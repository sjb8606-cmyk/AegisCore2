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
  __resetJobPermitTrackingStore,
  createPermitRecord,
  flagExpiringPermits,
  updateStatus
} from '../index';

describe('job-permit-tracking', () => {
  beforeEach(() => {
    __resetJobPermitTrackingStore();
  });

  it('creates a pending permit record', async () => {
    const permit = await createPermitRecord(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'Electrical permit',
      'Moncton'
    );

    expect(permit.status).toBe('pending');
    expect(permit.permitType)
      .toBe('Electrical permit');
  });

  it('requires a permit number when marking a permit pulled', async () => {
    const tenantId = crypto.randomUUID();

    const permit = await createPermitRecord(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      'Plumbing permit',
      'Dieppe'
    );

    await expect(
      updateStatus(
        tenantId,
        crypto.randomUUID(),
        permit.permitId,
        'pulled'
      )
    ).rejects.toThrow();
  });

  it('flags permits expiring within the requested window', async () => {
    const tenantId = crypto.randomUUID();

    const permit = await createPermitRecord(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      'HVAC permit',
      'Riverview'
    );

    await updateStatus(
      tenantId,
      crypto.randomUUID(),
      permit.permitId,
      'pulled',
      'PERMIT-001',
      new Date(),
      new Date(
        Date.now() + 5 * 24 * 60 * 60 * 1000
      )
    );

    const expiring =
      await flagExpiringPermits(
        tenantId,
        crypto.randomUUID(),
        7
      );

    expect(expiring).toHaveLength(1);
    expect(expiring[0].permitId)
      .toBe(permit.permitId);
  });
});
