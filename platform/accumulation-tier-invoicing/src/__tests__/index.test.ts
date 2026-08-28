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
  __resetAccumulationTierInvoicingStore,
  calculateTier,
  generateTieredInvoice,
  getInvoice
} from '../index';

describe('accumulation-tier-invoicing', () => {
  beforeEach(() => {
    __resetAccumulationTierInvoicingStore();
  });

  it('calculates the correct snowfall tier', () => {
    expect(calculateTier(1)).toBe(1);
    expect(calculateTier(4)).toBe(2);
    expect(calculateTier(8)).toBe(3);
  });

  it('rejects negative accumulation', () => {
    expect(() => calculateTier(-1)).toThrow();
  });

  it('creates a tenant-scoped tiered invoice', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();

    const invoice = await generateTieredInvoice(
      tenantId,
      actorId,
      propertyId,
      7
    );

    expect(invoice.tenantId).toBe(tenantId);
    expect(invoice.propertyId).toBe(propertyId);
    expect(invoice.tierApplied).toBe(3);
    expect(invoice.totalAmount).toBe(250);

    const loaded = await getInvoice(
      tenantId,
      actorId,
      invoice.invoiceId
    );

    expect(loaded.invoiceId).toBe(invoice.invoiceId);
  });
});
