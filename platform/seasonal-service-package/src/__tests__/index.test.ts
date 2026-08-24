import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const actual = await vi.importActual<any>('@platform/crud-kernel');

  return {
    ...actual,
    runCrudOperation: async (options: any) => options.action()
  };
});

import {
  __resetSeasonalServicePackageStore,
  checkUpsellTrigger,
  createPackage,
  deductVisit,
  getRemainingVisits
} from '../index';

describe('seasonal-service-package', () => {
  beforeEach(() => {
    __resetSeasonalServicePackageStore();
  });

  it('creates a package and deducts a visit', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const servicePackage = await createPackage(
      tenantId,
      actorId,
      {
        name: 'Spring cleanup + weekly cuts',
        includedVisits: 20,
        visitsUsed: 0,
        expiryDate: new Date('2026-12-31T23:59:59Z'),
        upsellThreshold: 3
      }
    );

    const updated = await deductVisit(
      tenantId,
      actorId,
      servicePackage.id
    );

    expect(updated.visitsUsed).toBe(1);

    const remaining = await getRemainingVisits(
      tenantId,
      actorId,
      servicePackage.id
    );

    expect(remaining).toBe(19);
  });

  it('rejects deduction after all included visits are used', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const servicePackage = await createPackage(
      tenantId,
      actorId,
      {
        name: 'Five visits',
        includedVisits: 5,
        visitsUsed: 5,
        expiryDate: new Date('2026-12-31T23:59:59Z'),
        upsellThreshold: 1
      }
    );

    await expect(
      deductVisit(
        tenantId,
        actorId,
        servicePackage.id
      )
    ).rejects.toThrow();
  });

  it('triggers upsell when remaining visits reach the threshold', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const servicePackage = await createPackage(
      tenantId,
      actorId,
      {
        name: 'Seasonal package',
        includedVisits: 20,
        visitsUsed: 17,
        expiryDate: new Date('2026-12-31T23:59:59Z'),
        upsellThreshold: 3
      }
    );

    const triggered = await checkUpsellTrigger(
      tenantId,
      actorId,
      servicePackage.id
    );

    expect(triggered).toBe(true);
  });
});
