import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const InvoiceLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0.01),
  unit_price_cents: z.number().int().min(0),
});

export const CreateInvoiceSchema = z.object({
  client_id: z.string().uuid().optional(),
  client_name: z.string().min(1),
  client_email: z.string().email(),
  line_items: z.array(InvoiceLineItemSchema).min(1),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

export const RecordPaymentSchema = z.object({
  amount_cents: z.number().int().min(1),
  method: z.string().min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const InvoicingConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    recurringInvoices: z.boolean().default(false),
    partialPayments: z.boolean().default(false),
    taxCalculation: z.boolean().default(false),
    discounts: z.boolean().default(false),
    customBranding: z.boolean().default(false),
    pdfGeneration: z.boolean().default(true),
    reminderEmails: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    multiCurrency: z.boolean().default(false),
    clientPortal: z.boolean().default(false),
  }),
  limits: z.object({
    invoicesPerMonth: z.number().default(10),
    lineItemsPerInvoice: z.number().default(20),
    paymentTermsDays: z.number().default(30),
    invoiceRetentionYears: z.number().default(7),
  }),
  currency: z.string().default('CAD'),
  taxRate: z.number().default(0),
});

export type InvoicingConfig = z.infer<typeof InvoicingConfigSchema>;

let cachedConfig: InvoicingConfig | null = null;

export function loadConfig(): InvoicingConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/invoicing.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = InvoicingConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = InvoicingConfigSchema.parse({
    enabled: true,
    tiers: {
      recurringInvoices: false,
      partialPayments: false,
      taxCalculation: false,
      discounts: false,
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
    taxRate: 0,
  });
  return cachedConfig;
}

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class InvoicingService {
  static async createInvoice(tenantId: string, userId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Invoicing globally disabled', ErrorCode.FORBIDDEN);
    }

    const input = CreateInvoiceSchema.parse(data);
    const cleanUserId = parseUserId(userId);

    // Enforce monthly limits
    const currentCount = await this.getTenantUsageThisMonth(tenantId);
    if (currentCount >= config.limits.invoicesPerMonth) {
      throw new AppError(`Invoices limit reached (${config.limits.invoicesPerMonth}/month)`, ErrorCode.FORBIDDEN);
    }

    // Limit line items per invoice
    if (input.line_items.length > config.limits.lineItemsPerInvoice) {
      throw new AppError(`Line items limit reached (${config.limits.lineItemsPerInvoice}/invoice)`, ErrorCode.FORBIDDEN);
    }

    // Generate invoice number incremented per tenant
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    // Calculate totals
    let subtotalCents = 0;
    for (const item of input.line_items) {
      subtotalCents += Math.round(item.quantity * item.unit_price_cents);
    }

    const discountCents = 0; // standard tier disables discounts
    const taxCents = 0; // standard tier disables taxCalculation
    const totalCents = subtotalCents;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + config.limits.paymentTermsDays);

    const invoiceSql = `
      INSERT INTO invoices (
        tenant_id, invoice_number, client_id, client_name, client_email, 
        status, due_date, subtotal_cents, discount_cents, tax_cents, 
        total_cents, paid_cents, currency, notes, terms
      ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, 'draft', $6, $7, $8, $9, $10, 0, $11, $12, $13)
      RETURNING *
    `;
    const invoiceParams = [
      tenantId,
      invoiceNumber,
      input.client_id || null,
      input.client_name,
      input.client_email,
      dueDate,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      config.currency,
      input.notes || null,
      input.terms || null
    ];

    const invoiceRows = await withTenantQuery(invoiceSql, invoiceParams, tenantId);
    if (!invoiceRows || invoiceRows.length === 0) {
      throw new AppError('Failed to persist invoice details', ErrorCode.INTERNAL);
    }

    const invoice = invoiceRows[0];

    // Store line items
    for (let i = 0; i < input.line_items.length; i++) {
      const item = input.line_items[i];
      const itemTotalCents = Math.round(item.quantity * item.unit_price_cents);
      const lineItemSql = `
        INSERT INTO invoice_line_items (
          tenant_id, invoice_id, description, quantity, unit_price_cents, 
          discount_percent, tax_percent, total_cents, sort_order
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, 0, 0, $6, $7)
      `;
      await withTenantQuery(lineItemSql, [
        tenantId,
        invoice.id,
        item.description,
        item.quantity,
        item.unit_price_cents,
        itemTotalCents,
        i
      ], tenantId);
    }

    return invoice;
  }

  static async recordPayment(tenantId: string, id: string, paymentData: any, userId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Invoicing globally disabled', ErrorCode.FORBIDDEN);
    }

    const payment = RecordPaymentSchema.parse(paymentData);
    const cleanUserId = parseUserId(userId);

    const checkSql = `SELECT * FROM invoices WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`;
    const checkRows = await withTenantQuery(checkSql, [id, tenantId], tenantId);
    if (!checkRows || checkRows.length === 0) {
      throw new AppError('Invoice not found', ErrorCode.NOT_FOUND);
    }

    const invoice = checkRows[0];
    if (invoice.status === 'void' || invoice.status === 'canceled') {
      throw new AppError('Cannot record payment against a voided or canceled invoice.', ErrorCode.FORBIDDEN);
    }

    const newPaidCents = Number(invoice.paid_cents) + payment.amount_cents;
    const totalCents = Number(invoice.total_cents);

    if (newPaidCents > totalCents && !config.tiers.partialPayments) {
      throw new AppError('Partial or overpayments require upgraded billing tier.', ErrorCode.FORBIDDEN);
    }

    let newStatus = 'sent';
    if (newPaidCents >= totalCents) {
      newStatus = 'paid';
    } else if (newPaidCents > 0) {
      if (!config.tiers.partialPayments) {
        throw new AppError('Partial payments are disabled on current tier', ErrorCode.FORBIDDEN);
      }
      newStatus = 'partial';
    }

    // Insert payment record
    const paymentSql = `
      INSERT INTO invoice_payments (tenant_id, invoice_id, amount_cents, currency, method, reference, notes, recorded_by)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)
    `;
    await withTenantQuery(paymentSql, [
      tenantId,
      id,
      payment.amount_cents,
      invoice.currency,
      payment.method,
      payment.reference || null,
      payment.notes || null,
      cleanUserId
    ], tenantId);

    // Update invoice status atomically
    const updateSql = `
      UPDATE invoices 
      SET paid_cents = $1, status = $2, paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END
      WHERE id = $3::uuid AND tenant_id = $4::uuid
      RETURNING *
    `;
    const updateRows = await withTenantQuery(updateSql, [newPaidCents, newStatus, id, tenantId], tenantId);
    return updateRows[0];
  }

  static async voidInvoice(tenantId: string, id: string, userId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Invoicing globally disabled', ErrorCode.FORBIDDEN);
    }

    const checkSql = `SELECT * FROM invoices WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`;
    const checkRows = await withTenantQuery(checkSql, [id, tenantId], tenantId);
    if (!checkRows || checkRows.length === 0) {
      throw new AppError('Invoice not found', ErrorCode.NOT_FOUND);
    }

    const updateSql = `
      UPDATE invoices 
      SET status = 'void', deleted_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2::uuid
      RETURNING *
    `;
    await withTenantQuery(updateSql, [id, tenantId], tenantId);
  }

  static async getInvoice(tenantId: string, id: string) {
    const checkSql = `SELECT * FROM invoices WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`;
    const checkRows = await withTenantQuery(checkSql, [id, tenantId], tenantId);
    if (!checkRows || checkRows.length === 0) {
      throw new AppError('Invoice not found', ErrorCode.NOT_FOUND);
    }
    return checkRows[0];
  }

  static async listInvoices(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, invoice_number, client_name, client_email, status, issue_date, due_date, total_cents, paid_cents, currency, created_at 
      FROM invoices 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }

  static async getTenantUsageThisMonth(tenantId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*)::int as count 
      FROM invoices 
      WHERE tenant_id = $1::uuid 
        AND created_at >= date_trunc('month', current_date)
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0]?.count || 0;
  }

  static async generateInvoiceNumber(tenantId: string): Promise<string> {
    const sql = `
      SELECT COUNT(*)::int as count 
      FROM invoices 
      WHERE tenant_id = $1::uuid
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    const count = (rows[0]?.count || 0) + 1;
    return `INV-${String(count).padStart(4, '0')}`;
  }

  static async fetchSummary(tenantId: string): Promise<any> {
    const sql = `
      SELECT COALESCE(SUM(total_cents), 0)::bigint as total_revenue,
             COALESCE(SUM(paid_cents), 0)::bigint as total_collected
      FROM invoices 
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
    `;
    const rows = await withTenantQuery(sql, [tenantId], tenantId);
    return rows[0];
  }
}
