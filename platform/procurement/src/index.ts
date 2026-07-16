import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';

export const ProcurementConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    purchaseRequests: z.boolean().default(true),
    approvalWorkflows: z.boolean().default(true),
    vendorManagement: z.boolean().default(true),
    purchaseOrders: z.boolean().default(true),
    goodsReceiving: z.boolean().default(true),
    invoiceMatching: z.boolean().default(true),
    rfqRfpWorkflows: z.boolean().default(false),
    contractManagement: z.boolean().default(false),
    budgetControls: z.boolean().default(false),
    vendorRiskScoring: z.boolean().default(false),
    complianceTracking: z.boolean().default(false),
    bulkImports: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    aiProcurementInsights: z.boolean().default(false),
  }),
  limits: z.object({
    purchaseRequestsPerMonth: z.number().default(50000),
    vendors: z.number().default(100000),
    purchaseOrdersPerMonth: z.number().default(100000),
    approvalStages: z.number().default(10),
  }),
  thresholds: z.object({
    managerApprovalAmount: z.number().default(1000),
    directorApprovalAmount: z.number().default(10000),
    executiveApprovalAmount: z.number().default(50000),
  }),
});

export type ProcurementConfig = z.infer<typeof ProcurementConfigSchema>;

export interface PurchaseRequestInput {
  title: string;
  description?: string;
  items: PurchaseItemInput[];
}

export interface PurchaseItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
  description?: string;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig(): ProcurementConfig {
  const configPath = path.join(process.cwd(), 'config', 'procurement.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return ProcurementConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return ProcurementConfigSchema.parse({
    enabled: true,
    tiers: { auditTrail: true, approvalWorkflows: true },
    limits: { purchaseRequestsPerMonth: 50000 },
    thresholds: { managerApprovalAmount: 1000, directorApprovalAmount: 10000, executiveApprovalAmount: 50000 }
  });
}

async function generateRequestNumber(tenantId: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery("SELECT COUNT(*) as seq FROM purchase_requests WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE", [tenantId], tenantId);
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `PR-${date}-${seq}`;
}

export async function createPurchaseRequest(tenantId: string, userId: string, data: PurchaseRequestInput) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Procurement vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM purchase_requests WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.purchaseRequestsPerMonth) {
    throw new AppError('Monthly procurement limits reached', ErrorCode.RATE_LIMITED);
  }

  const requestNumber = await generateRequestNumber(tenantId);
  const requestId = crypto.randomUUID();

  // 1. Insert Purchase Request Header
  const insertReport = `
    INSERT INTO purchase_requests (id, tenant_id, request_number, title, description, requested_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertReport, [
    requestId, tenantId, requestNumber, data.title, data.description || null, cleanUserId
  ], tenantId);

  // 2. Insert Items & Sum Total Cents
  let totalCents = 0;
  const items = data.items || [];
  for (const item of items) {
    const qty = item.quantity || 1;
    const unitPrice = item.unitPrice || 0;
    const itemTotal = qty * unitPrice;
    totalCents += itemTotal;

    const itemId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO purchase_items (id, tenant_id, request_id, name, quantity, unit_price_cents, total_cents)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `, [itemId, tenantId, requestId, item.name, qty, unitPrice, itemTotal], tenantId);
  }

  // 3. Update total sum in Purchase Header
  await withTenantQuery('UPDATE purchase_requests SET total_cents = $1 WHERE id = $2 AND tenant_id = $3', [totalCents, requestId, tenantId], tenantId);

  return { ...result[0], total_cents: totalCents };
}

export async function submitPurchaseRequest(tenantId: string, requestId: string, userId: string) {
  // Check state is draft
  const reportRes = await withTenantQuery('SELECT status FROM purchase_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [requestId, tenantId], tenantId);
  if (!reportRes[0]) throw new AppError('Purchase request not found', ErrorCode.NOT_FOUND);
  if (reportRes[0].status !== 'draft') throw new AppError('Only draft purchase requests can be submitted', ErrorCode.BAD_REQUEST);

  // Atomically transition status to submitted
  await withTenantQuery('UPDATE purchase_requests SET status = \'submitted\', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2', [requestId, tenantId], tenantId);

  // Spawns pending approval task
  const approvalId = crypto.randomUUID();
  const approverId = '00000000-0000-0000-0000-000000000001'; // designated financial controller
  
  await withTenantQuery(`
    INSERT INTO purchase_approvals (id, tenant_id, request_id, approver_id, status)
    VALUES ($1, $2, $3, $4, 'pending');
  `, [approvalId, tenantId, requestId, approverId], tenantId);

  return { success: true, status: 'submitted', approval_id: approvalId };
}

export async function approvePurchaseRequest(tenantId: string, requestId: string, approverId: string, reason: string) {
  const cleanApproverId = parseUserId(approverId);

  // Verify status is submitted
  const reportRes = await withTenantQuery('SELECT status FROM purchase_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [requestId, tenantId], tenantId);
  if (!reportRes[0]) throw new AppError('Purchase request not found', ErrorCode.NOT_FOUND);
  if (reportRes[0].status !== 'submitted') throw new AppError('Request is not pending review', ErrorCode.BAD_REQUEST);

  await withTenantQuery(`
    UPDATE purchase_approvals 
    SET status = 'approved', resolved_at = CURRENT_TIMESTAMP, reason = $1
    WHERE request_id = $2 AND approver_id = $3 AND tenant_id = $4;
  `, [reason, requestId, cleanApproverId, tenantId], tenantId);

  await withTenantQuery(`
    UPDATE purchase_requests 
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [requestId, tenantId], tenantId);

  return { success: true };
}

export async function getPurchaseDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM purchase_requests WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const report = res[0];
  if (!report) throw new AppError('Purchase request not found', ErrorCode.NOT_FOUND);

  const items = await withTenantQuery('SELECT id, name, quantity, unit_price_cents, total_cents FROM purchase_items WHERE request_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const approvals = await withTenantQuery('SELECT id, status, reason, resolved_at FROM purchase_approvals WHERE request_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);

  return { ...report, items, approvals };
}
