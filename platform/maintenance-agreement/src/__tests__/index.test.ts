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
  __resetMaintenanceAgreementStore,
  checkRenewalDue,
  createMaintenanceAgreement,
  logVisitCompleted,
  scheduleAnnualVisits
} from '../index';

describe('maintenance-agreement', () => {
  beforeEach(() => {
    __resetMaintenanceAgreementStore();
  });

  it('creates an agreement and schedules its annual visits', async () => {
    const tenantId = crypto.randomUUID();

    const agreement =
      await createMaintenanceAgreement(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        ['furnace-001'],
        2,
        new Date('2026-10-01T00:00:00Z'),
        true
      );

    const visits =
      await scheduleAnnualVisits(
        tenantId,
        crypto.randomUUID(),
        agreement.agreementId
      );

    expect(visits).toHaveLength(2);
    expect(visits[0].getUTCMonth()).toBe(9);
    expect(visits[1].getUTCMonth()).toBe(3);
  });

  it('increments completed visits without exceeding the agreement limit', async () => {
    const tenantId = crypto.randomUUID();

    const agreement =
      await createMaintenanceAgreement(
        tenantId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        [],
        1,
        new Date('2027-01-01T00:00:00Z'),
        false
      );

    const completed =
      await logVisitCompleted(
        tenantId,
        crypto.randomUUID(),
        agreement.agreementId
      );

    expect(
      completed.visitsCompletedThisCycle
    ).toBe(1);

    await expect(
      logVisitCompleted(
        tenantId,
        crypto.randomUUID(),
        agreement.agreementId
      )
    ).rejects.toThrow();
  });

  it('returns only tenant agreements due within the requested window', async () => {
    const tenantId = crypto.randomUUID();

    await createMaintenanceAgreement(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      [],
      2,
      new Date(
        Date.now() +
          10 * 24 * 60 * 60 * 1000
      ),
      false
    );

    await createMaintenanceAgreement(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      [],
      2,
      new Date(
        Date.now() +
          60 * 24 * 60 * 60 * 1000
      ),
      false
    );

    const due =
      await checkRenewalDue(
        tenantId,
        crypto.randomUUID(),
        30
      );

    expect(due).toHaveLength(1);
  });
});
