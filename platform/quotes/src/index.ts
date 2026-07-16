import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';

export const QuotesConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    quoteBuilder: z.boolean().default(true),
    lineItems: z.boolean().default(true),
    taxAndDiscounts: z.boolean().default(true),
    pdfExport: z.boolean().default(true),
    approvalWorkflow: z.boolean().default(true),
    customerApproval: z.boolean().default(true),
    quoteVersioning: z.boolean().default(false),
    esignatures: z.boolean().default(false),
    autoConvertInvoice: z.boolean().default(false),
    multiStageApprovals: z.boolean().default(false),
    customTemplates: z.boolean().default(false),
    negotiationTracking: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    bulkQuotes: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
  }),
  limits: z.object({
    quotesPerMonth: z.number().default(5000),
    lineItemsPerQuote: z.number().default(250),
    approvalStages: z.number().default(5),
    quoteRetentionDays: z.number().default(3650),
  }),
  thresholds: z.object({
    autoApprovalAmount: z.number().default(1000),
    highRiskApprovalAmount: z.number().default(10000),
  }),
});

export type QuotesConfig = z.infer<typeof QuotesConfigSchema>;

export interface QuoteInput {
  title: string;
  description?: string;
  customerId?: string;
  lineItems: QuoteLineItemInput[];
  validUntil?: string;
  notes?: string;
}

export interface QuoteLineItemInput {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig(): QuotesConfig {
  const configPath = path.join(process.cwd(), 'config', 'quotes.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return QuotesConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return QuotesConfigSchema.parse({
    enabled: true,
    tiers: { quoteVersioning: true },
    limits: { quotesPerMonth: 5000, lineItemsPerQuote: 250 },
    thresholds: { autoApprovalAmount: 1000, highRiskApprovalAmount: 10000 }
  });
}

async function generateQuoteNumber(tenantId: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery("SELECT COUNT(*) as seq FROM quotes WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE", [tenantId], tenantId);
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `QT-${date}-${seq}`;
}

export async function createQuote(tenantId: string, userId: string, data: QuoteInput) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Quotes vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM quotes WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.quotesPerMonth) {
    throw new AppError('Monthly quote generation limits reached', ErrorCode.RATE_LIMITED);
  }

  const items = data.lineItems || [];
  if (items.length > cfg.limits.lineItemsPerQuote) {
    throw new AppError('Line item limits reached per quote', ErrorCode.BAD_REQUEST);
  }

  const quoteNumber = await generateQuoteNumber(tenantId);
  const quoteId = crypto.randomUUID();

  // 1. Insert Quote Header
  const insertQuote = `
    INSERT INTO quotes (id, tenant_id, quote_number, title, description, created_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuote, [
    quoteId, tenantId, quoteNumber, data.title, data.description || null, cleanUserId
  ], tenantId);

  // 2. Insert Lines & Sum Total Cents
  let totalCents = 0;
  for (const item of items) {
    const qty = item.quantity || 1;
    const unitPrice = item.unitPrice || 0;
    const discount = item.discountAmount || 0;
    const itemTotal = (qty * unitPrice) - discount;
    totalCents += itemTotal;

    const lineId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO quote_lines (id, tenant_id, quote_id, name, description, quantity, unit_price_cents, discount_cents, total_cents)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `, [lineId, tenantId, quoteId, item.name, item.description || null, qty, unitPrice, discount, itemTotal], tenantId);
  }

  // 3. Update total sum in Quote Header
  await withTenantQuery('UPDATE quotes SET total_cents = $1 WHERE id = $2 AND tenant_id = $3', [totalCents, quoteId, tenantId], tenantId);

  // 4. Create Immutable Snapshot Version
  if (cfg.tiers.quoteVersioning) {
    const versionId = crypto.randomUUID();
    const snapshot = { ...result[0], total_cents: totalCents, lines: items };
    await withTenantQuery(`
      INSERT INTO quote_versions (id, tenant_id, quote_id, version_number, snapshot)
      VALUES ($1, $2, $3, 1, $4);
    `, [versionId, tenantId, quoteId, JSON.stringify(snapshot)], tenantId);
  }

  return { ...result[0], total_cents: totalCents };
}

export async function requestApproval(tenantId: string, quoteId: string, approverId: string) {
  const cleanApproverId = parseUserId(approverId);
  const approvalId = crypto.randomUUID();

  // Atomically transition quote state to pending
  await withTenantQuery(`
    UPDATE quotes SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [quoteId, tenantId], tenantId);

  const insertQuery = `
    INSERT INTO quote_approvals (id, tenant_id, quote_id, approver_id, status)
    VALUES ($1, $2, $3, $4, 'pending') RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [approvalId, tenantId, quoteId, cleanApproverId], tenantId);

  return res[0];
}

export async function approveQuote(tenantId: string, quoteId: string, approverId: string, reason: string) {
  const cleanApproverId = parseUserId(approverId);

  // Verify status is pending
  const quoteRes = await withTenantQuery('SELECT status FROM quotes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [quoteId, tenantId], tenantId);
  if (!quoteRes[0]) throw new AppError('Quote not found', ErrorCode.NOT_FOUND);
  if (quoteRes[0].status !== 'pending_approval') throw new AppError('Quote is not pending approval', ErrorCode.BAD_REQUEST);

  await withTenantQuery(`
    UPDATE quote_approvals 
    SET status = 'approved', resolved_at = CURRENT_TIMESTAMP, reason = $1
    WHERE quote_id = $2 AND approver_id = $3 AND tenant_id = $4;
  `, [reason, quoteId, cleanApproverId, tenantId], tenantId);

  await withTenantQuery(`
    UPDATE quotes 
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [quoteId, tenantId], tenantId);

  return { success: true };
}

export async function getQuoteDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM quotes WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const quote = res[0];
  if (!quote) throw new AppError('Quote not found', ErrorCode.NOT_FOUND);

  const lines = await withTenantQuery('SELECT id, name, quantity, unit_price_cents, total_cents FROM quote_lines WHERE quote_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const versions = await withTenantQuery('SELECT version_number, snapshot FROM quote_versions WHERE quote_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);

  return { ...quote, lines, versions };
}
