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
  loadConfig: vi.fn(() => ({
    enabled: true,
    defaultWarrantyWindowDays: 0
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
  const actual = await vi.importActual<any>('@platform/crud-kernel');

  return {
    ...actual,
    runCrudOperation: async (options: any) => options.action()
  };
});

import {
  __resetChemicalTreatmentLogStore,
  checkActiveWarranty,
  createTreatment,
  getSdsLink,
  logApplication
} from '../index';

describe('chemical-treatment-log', () => {
  beforeEach(() => {
    __resetChemicalTreatmentLogStore();
  });

  it('logs a chemical application', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const visitId = crypto.randomUUID();

    const treatment = await logApplication(
      tenantId,
      actorId,
      visitId,
      'Product A',
      2.5,
      'spray'
    );

    expect(treatment.visitId).toBe(visitId);
    expect(treatment.productName).toBe('Product A');
    expect(treatment.quantityApplied).toBe(2.5);
  });

  it('rejects a non-positive quantity', async () => {
    await expect(
      logApplication(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        'Product A',
        0,
        'spray'
      )
    ).rejects.toThrow();
  });

  it('returns the SDS link for a tenant-scoped product', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    await createTreatment(tenantId, actorId, {
      visitId: crypto.randomUUID(),
      productName: 'Product B',
      quantityApplied: 1,
      unit: 'L',
      applicationMethod: 'spray',
      targetArea: 'foundation',
      sdsReferenceUrl: 'https://example.com/sds/product-b',
      warrantyWindowDays: 30
    });

    const link = await getSdsLink(
      tenantId,
      actorId,
      'Product B'
    );

    expect(link).toBe(
      'https://example.com/sds/product-b'
    );

    const otherTenantResult = await checkActiveWarranty(
      crypto.randomUUID(),
      actorId,
      crypto.randomUUID()
    );

    expect(otherTenantResult).toBe(false);
  });
});
