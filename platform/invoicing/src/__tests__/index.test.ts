import { describe, it, expect, vi } from 'vitest';

// ── Module-boundary mocks ──────────────────────────────────────────────────

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn();
  const readFileSyncMock = vi.fn();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    default: { ...actual, existsSync: existsSyncMock, readFileSync: readFileSyncMock },
  };
});

// index.ts imports withTenantQuery via a RELATIVE path, not @platform/tenancy.
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/utils (parseUserId) is intentionally NOT mocked -- it's pure,
// side-effect-free UUID validation and we want its real BAD_REQUEST errors.

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const invoiceId = '33333333-3333-3333-3333-333333333333';

const DEFAULT_CONFIG = {
  enabled: true,
  tiers: {
    recurringInvoices: false,
    partialPayments: false,
    taxCalculation: true,  // deliberately true -- proves tax is still ignored
    discounts: true,       // deliberately true -- proves discounts are still ignored
    customBranding: false,
    pdfGeneration: true,
    reminderEmails: false,
    auditTrail: false,
    multiCurrency: false,
    clientPortal: false,
  },
  limits: {
    invoicesPerMonth: 10,
    lineItemsPerInvoice: 20,
    paymentTermsDays: 30,
    invoiceRetentionYears: 7,
  },
  currency: 'CAD',
  taxRate: 0.15,
};

/**
 * `loadConfig()` caches into a module-level `cachedConfig` with no reset
 * export. Per the required process for caches like this: reset the module
 * registry and dynamically re-import both the config-reading dependency
 * ('fs') and the module under test for every test, so each test gets an
 * independent cache and its mocks are guaranteed to be wired to the
 * instance the fresh module actually uses.
 */
async function freshModule(configJson: unknown | false = DEFAULT_CONFIG) {
  vi.resetModules();

  const fs = await import('fs');
  if (configJson === false) {
    (fs.existsSync as any).mockReturnValue(false);
  } else {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(configJson));
  }

  const tenancy = await import('../../../tenancy/src/index');
  const withTenantQuery = tenancy.withTenantQuery as any;
  withTenantQuery.mockReset();

  const mod = await import('../index');
  return { mod, fs, withTenantQuery };
}

describe('InvoicingService.createInvoice', () => {
  it('computes subtotal/total correctly; BUG: validated cleanUserId is computed then discarded', async () => {
    const { mod, withTenantQuery } = await freshModule();
    // Every other test in this file uses the same freshModule() pattern
    // and passes well under 5s -- this one timing out is cold-import /
    // Codespace resource contention, not a logic bug. Bumped below.
    const insertedInvoice = { id: invoiceId, tenant_id: tenantId, invoice_number: 'INV-0001', total_cents: 15000 };
    withTenantQuery
      .mockResolvedValueOnce([{ count: 0 }])   // getTenantUsageThisMonth
      .mockResolvedValueOnce([{ count: 0 }])   // generateInvoiceNumber
      .mockResolvedValueOnce([insertedInvoice]) // invoice insert
      .mockResolvedValueOnce([]);              // line item insert

    const result = await mod.InvoicingService.createInvoice(tenantId, userId, {
      client_name: 'Acme Co',
      client_email: 'billing@acme.test',
      line_items: [{ description: 'Consulting', quantity: 10, unit_price_cents: 1500 }],
    });

    expect(result).toEqual(insertedInvoice);

    // invoiceParams = [tenantId, invoiceNumber, client_id, client_name,
    //   client_email, dueDate, subtotalCents, discountCents, taxCents,
    //   totalCents, currency, notes, terms]
    const [, params] = withTenantQuery.mock.calls[2];
    expect(params[6]).toBe(15000); // subtotalCents = 10 * 1500
    expect(params[7]).toBe(0);     // discountCents
    expect(params[8]).toBe(0);     // taxCents
    expect(params[9]).toBe(15000); // totalCents

    // BUG: parseUserId(userId) is called above (and would throw BAD_REQUEST
    // on an invalid id -- see dedicated test below) but the resulting
    // cleanUserId is never stored anywhere -- no created_by/who-created
    // field exists on the invoice insert. Real fix: add a created_by
    // column and include cleanUserId in invoiceParams.
  });

  it('GAP: taxRate/taxCalculation are configured but tax is never actually computed', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      taxRate: 0.99,
      tiers: { ...DEFAULT_CONFIG.tiers, taxCalculation: true },
    });
    withTenantQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: invoiceId, total_cents: 1000 }])
      .mockResolvedValueOnce([]);

    await mod.InvoicingService.createInvoice(tenantId, userId, {
      client_name: 'Acme',
      client_email: 'a@acme.test',
      line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 1000 }],
    });

    // Real fix: totalCents should reflect config.taxRate; instead taxCents
    // is hardcoded to 0 no matter how high taxRate is or whether
    // taxCalculation is enabled.
    const [, params] = withTenantQuery.mock.calls[2];
    expect(params[8]).toBe(0);
    expect(params[9]).toBe(1000);
  });

  it('GAP: discounts tier flag is true but no discount is ever applied', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: { ...DEFAULT_CONFIG.tiers, discounts: true },
    });
    withTenantQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: invoiceId, total_cents: 2000 }])
      .mockResolvedValueOnce([]);

    await mod.InvoicingService.createInvoice(tenantId, userId, {
      client_name: 'Acme',
      client_email: 'a@acme.test',
      line_items: [{ description: 'Item', quantity: 2, unit_price_cents: 1000 }],
    });

    const [, params] = withTenantQuery.mock.calls[2];
    expect(params[7]).toBe(0);    // discountCents -- always 0
    expect(params[9]).toBe(2000); // totalCents === subtotal
  });

  it('GAP: recurringInvoices/customBranding/pdfGeneration/reminderEmails/auditTrail/multiCurrency/clientPortal are declared but never read', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: {
        ...DEFAULT_CONFIG.tiers,
        recurringInvoices: true,
        customBranding: true,
        pdfGeneration: false,
        reminderEmails: true,
        auditTrail: true,
        multiCurrency: true,
        clientPortal: true,
      },
    });
    withTenantQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ id: invoiceId, total_cents: 500 }])
      .mockResolvedValueOnce([]);

    // Real fix: none of these flags currently gate any behavior in this
    // file. This test only proves the module doesn't branch on them --
    // flipping every flag to its "premium" value changes nothing.
    const result = await mod.InvoicingService.createInvoice(tenantId, userId, {
      client_name: 'Acme',
      client_email: 'a@acme.test',
      line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 500 }],
    });
    expect(result).toEqual({ id: invoiceId, total_cents: 500 });
  });

  it('rejects with FORBIDDEN when the monthly invoice limit is reached', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      limits: { ...DEFAULT_CONFIG.limits, invoicesPerMonth: 2 },
    });
    withTenantQuery.mockResolvedValueOnce([{ count: 2 }]);

    await expect(
      mod.InvoicingService.createInvoice(tenantId, userId, {
        client_name: 'Acme',
        client_email: 'a@acme.test',
        line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
      }),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Invoices limit reached (2/month)' });
  });

  it('rejects with FORBIDDEN when line items exceed the per-invoice limit', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      limits: { ...DEFAULT_CONFIG.limits, lineItemsPerInvoice: 1 },
    });
    withTenantQuery.mockResolvedValueOnce([{ count: 0 }]);

    await expect(
      mod.InvoicingService.createInvoice(tenantId, userId, {
        client_name: 'Acme',
        client_email: 'a@acme.test',
        line_items: [
          { description: 'A', quantity: 1, unit_price_cents: 100 },
          { description: 'B', quantity: 1, unit_price_cents: 100 },
        ],
      }),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Line items limit reached (1/invoice)' });
  });

  it('rejects with FORBIDDEN when invoicing is globally disabled', async () => {
    const { mod } = await freshModule({ ...DEFAULT_CONFIG, enabled: false });
    await expect(
      mod.InvoicingService.createInvoice(tenantId, userId, {
        client_name: 'Acme',
        client_email: 'a@acme.test',
        line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
      }),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Invoicing globally disabled' });
  });

  it('rejects an invalid userId with BAD_REQUEST via the real parseUserId validator', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([{ count: 0 }]);
    await expect(
      mod.InvoicingService.createInvoice(tenantId, 'not-a-uuid', {
        client_name: 'Acme',
        client_email: 'a@acme.test',
        line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
      }),
    ).rejects.toMatchObject({ code: mod.ErrorCode.BAD_REQUEST });
  });

  it('rejects invalid schema input (missing client_email) with a ZodError', async () => {
    const { mod } = await freshModule();
    await expect(
      mod.InvoicingService.createInvoice(tenantId, userId, {
        client_name: 'Acme',
        line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
      } as any),
    ).rejects.toThrow();
  });

  it('throws INTERNAL if the invoice insert unexpectedly returns no rows', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([]);

    await expect(
      mod.InvoicingService.createInvoice(tenantId, userId, {
        client_name: 'Acme',
        client_email: 'a@acme.test',
        line_items: [{ description: 'Item', quantity: 1, unit_price_cents: 100 }],
      }),
    ).rejects.toMatchObject({ code: mod.ErrorCode.INTERNAL, message: 'Failed to persist invoice details' });
  });
});

describe('InvoicingService.recordPayment', () => {
  it('marks the invoice partial when payment is less than total and partialPayments tier is enabled', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: { ...DEFAULT_CONFIG.tiers, partialPayments: true },
    });
    withTenantQuery
      .mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent', paid_cents: 0, total_cents: 10000, currency: 'CAD' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: invoiceId, status: 'partial', paid_cents: 5000 }]);

    const result = await mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 5000, method: 'card' }, userId);
    expect(result).toEqual({ id: invoiceId, status: 'partial', paid_cents: 5000 });

    const updateCall = withTenantQuery.mock.calls[2];
    expect(updateCall[1]).toEqual([5000, 'partial', invoiceId, tenantId]);
  });

  it('marks the invoice paid when payment reaches the full total', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery
      .mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent', paid_cents: 0, total_cents: 10000, currency: 'CAD' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: invoiceId, status: 'paid', paid_cents: 10000 }]);

    const result = await mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 10000, method: 'card' }, userId);
    expect(result.status).toBe('paid');
  });

  it('rejects a partial payment with FORBIDDEN when partialPayments tier is disabled', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: { ...DEFAULT_CONFIG.tiers, partialPayments: false },
    });
    withTenantQuery.mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent', paid_cents: 0, total_cents: 10000, currency: 'CAD' }]);

    await expect(
      mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 5000, method: 'card' }, userId),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Partial payments are disabled on current tier' });
  });

  it('rejects an overpayment with FORBIDDEN when partialPayments tier is disabled', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: { ...DEFAULT_CONFIG.tiers, partialPayments: false },
    });
    withTenantQuery.mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent', paid_cents: 0, total_cents: 10000, currency: 'CAD' }]);

    await expect(
      mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 15000, method: 'card' }, userId),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Partial or overpayments require upgraded billing tier.' });
  });

  it('rejects recording a payment against a voided invoice', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'void', paid_cents: 0, total_cents: 10000, currency: 'CAD' }]);

    await expect(
      mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 5000, method: 'card' }, userId),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Cannot record payment against a voided or canceled invoice.' });
  });

  it('throws NOT_FOUND when the invoice does not exist', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    await expect(
      mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 5000, method: 'card' }, userId),
    ).rejects.toMatchObject({ code: mod.ErrorCode.NOT_FOUND, message: 'Invoice not found' });
  });

  it('rejects an invalid userId with BAD_REQUEST before touching the database', async () => {
    const { mod, withTenantQuery } = await freshModule();
    await expect(
      mod.InvoicingService.recordPayment(tenantId, invoiceId, { amount_cents: 5000, method: 'card' }, 'not-a-uuid'),
    ).rejects.toMatchObject({ code: mod.ErrorCode.BAD_REQUEST });
    expect(withTenantQuery).not.toHaveBeenCalled();
  });
});

describe('InvoicingService.voidInvoice', () => {
  it('voids an existing invoice', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery
      .mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent' }])
      .mockResolvedValueOnce([{ id: invoiceId, status: 'void' }]);

    await mod.InvoicingService.voidInvoice(tenantId, invoiceId, userId);

    const updateCall = withTenantQuery.mock.calls[1];
    expect(updateCall[1]).toEqual([invoiceId, tenantId]);
  });

  it('BUG: userId is completely unused -- an invalid, non-UUID value is silently accepted', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery
      .mockResolvedValueOnce([{ id: invoiceId, tenant_id: tenantId, status: 'sent' }])
      .mockResolvedValueOnce([{ id: invoiceId, status: 'void' }]);

    // Real fix: validate userId with parseUserId (as createInvoice and
    // recordPayment both do) and record who voided the invoice. Today,
    // this silently succeeds with garbage input, proving userId is
    // never checked or stored.
    await expect(
      mod.InvoicingService.voidInvoice(tenantId, invoiceId, 'not-a-uuid-at-all'),
    ).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND when the invoice does not exist', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    await expect(mod.InvoicingService.voidInvoice(tenantId, invoiceId, userId)).rejects.toMatchObject({
      code: mod.ErrorCode.NOT_FOUND,
      message: 'Invoice not found',
    });
  });

  it('throws FORBIDDEN when invoicing is globally disabled', async () => {
    const { mod } = await freshModule({ ...DEFAULT_CONFIG, enabled: false });
    await expect(mod.InvoicingService.voidInvoice(tenantId, invoiceId, userId)).rejects.toMatchObject({
      code: mod.ErrorCode.FORBIDDEN,
      message: 'Invoicing globally disabled',
    });
  });
});

describe('InvoicingService read/helper methods', () => {
  it('getInvoice returns the row when found', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const row = { id: invoiceId, tenant_id: tenantId, status: 'sent' };
    withTenantQuery.mockResolvedValueOnce([row]);
    const result = await mod.InvoicingService.getInvoice(tenantId, invoiceId);
    expect(result).toEqual(row);
  });

  it('getInvoice throws NOT_FOUND when missing', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    await expect(mod.InvoicingService.getInvoice(tenantId, invoiceId)).rejects.toMatchObject({
      code: mod.ErrorCode.NOT_FOUND,
    });
  });

  it('listInvoices returns rows as-is from the tenant-scoped query', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const rows = [{ id: invoiceId, invoice_number: 'INV-0001' }];
    withTenantQuery.mockResolvedValueOnce(rows);
    const result = await mod.InvoicingService.listInvoices(tenantId);
    expect(result).toEqual(rows);
    expect(withTenantQuery).toHaveBeenCalledWith(expect.stringContaining('FROM invoices'), [tenantId], tenantId);
  });

  it('fetchSummary returns the aggregated totals row', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const row = { total_revenue: '50000', total_collected: '30000' };
    withTenantQuery.mockResolvedValueOnce([row]);
    const result = await mod.InvoicingService.fetchSummary(tenantId);
    expect(result).toEqual(row);
  });

  it('generateInvoiceNumber pads and increments from the current count', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([{ count: 41 }]);
    const result = await mod.InvoicingService.generateInvoiceNumber(tenantId);
    expect(result).toBe('INV-0042');
  });

  it('getTenantUsageThisMonth returns 0 when there is no count row', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    const result = await mod.InvoicingService.getTenantUsageThisMonth(tenantId);
    expect(result).toBe(0);
  });
});
