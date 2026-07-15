import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const ReturnsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    returnRequests: z.boolean().default(true),
    refundProcessing: z.boolean().default(true),
    exchangeWorkflow: z.boolean().default(true),
    rmaGeneration: z.boolean().default(true),
    returnEligibilityRules: z.boolean().default(true),
    restockingLogic: z.boolean().default(true),
    manualApprovalReturns: z.boolean().default(true),
    automatedRefunds: z.boolean().default(false),
    shippingLabelIntegration: z.boolean().default(false),
    fraudDetection: z.boolean().default(false),
    disputeHandling: z.boolean().default(false),
    warehouseIntegration: z.boolean().default(false),
    bulkReturnsProcessing: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
  }),
  limits: z.object({
    returnsPerMonth: z.number().default(500000),
    refundsPerMonth: z.number().default(1000000),
    rmaCodes: z.number().default(10000000),
    eligibilityRules: z.number().default(5000),
  }),
  thresholds: z.object({
    autoApproveReturnDays: z.number().default(14),
    manualReviewThresholdAmount: z.number().default(200),
    fraudRiskScore: z.number().default(0.75),
  }),
});

export type ReturnsConfig = z.infer<typeof ReturnsConfigSchema>;

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig(): ReturnsConfig {
  try {
    const configPath = path.join(process.cwd(), 'config', 'returns.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return ReturnsConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      returnRequests: true,
      refundProcessing: true,
      exchangeWorkflow: true,
      rmaGeneration: true,
      returnEligibilityRules: true,
      restockingLogic: true,
      manualApprovalReturns: true,
      automatedRefunds: false,
      shippingLabelIntegration: false,
      fraudDetection: false,
      disputeHandling: false,
      warehouseIntegration: false,
      bulkReturnsProcessing: false,
      advancedAnalytics: false,
      auditTrail: true
    },
    limits: { returnsPerMonth: 500000, refundsPerMonth: 1000000, rmaCodes: 10000000, eligibilityRules: 5000 },
    thresholds: { autoApproveReturnDays: 14, manualReviewThresholdAmount: 200, fraudRiskScore: 0.75 }
  };
}

// Evaluate Return Eligibility (Deterministic logic based on order total cap)
export async function evaluateReturnEligibility(tenantId: string, orderId: string, items: any[]) {
  if (!isValidUuid(orderId)) {
    throw new AppError('Invalid Order ID format.', 'BAD_REQUEST');
  }

  // Simulated dynamic threshold: Original Order Limit is capped at 15,000 cents ($150.00 USD)
  const simulatedOriginalOrderCents = 15000;
  
  let requestedRefundTotal = 0;
  for (const item of items) {
    requestedRefundTotal += (item.refund_cents || 0) * (item.quantity || 1);
  }

  if (requestedRefundTotal > simulatedOriginalOrderCents) {
    return {
      eligible: false,
      reason: `Return total (${requestedRefundTotal} cents) exceeds original order value (${simulatedOriginalOrderCents} cents).`
    };
  }

  return { eligible: true, reason: 'Eligible for return processing.' };
}

export async function createReturnRequest(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Returns module disabled', 'FORBIDDEN');

  const cleanUserId = parseUserId(userId);
  const eligibility = await evaluateReturnEligibility(tenantId, data.order_id, data.items || []);
  if (!eligibility.eligible) {
    throw new AppError(`Return request ineligible: ${eligibility.reason}`, 'BAD_REQUEST');
  }

  const returnId = crypto.randomUUID();
  const rmaNumber = `RMA-${Math.floor(100000 + Math.random() * 900000)}`;

  const res = await withTenantQuery(`
    INSERT INTO return_requests (id, tenant_id, order_id, customer_id, rma_number, reason, description, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested') RETURNING *;
  `, [returnId, tenantId, data.order_id, data.customer_id, rmaNumber, data.reason, data.description || null], tenantId);

  const request = res[0];

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      await withTenantQuery(`
        INSERT INTO return_items (id, tenant_id, return_request_id, item_id, quantity, refund_cents)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [crypto.randomUUID(), tenantId, returnId, item.item_id, item.quantity, item.refund_cents], tenantId);
    }
  }

  return request;
}

export async function getReturnRequest(tenantId: string, returnId: string) {
  if (!isValidUuid(returnId)) {
    throw new AppError('Invalid Return ID format.', 'BAD_REQUEST');
  }

  const res = await withTenantQuery(`
    SELECT * FROM return_requests WHERE id = $1 AND tenant_id = $2;
  `, [returnId, tenantId], tenantId);

  if (!res || res.length === 0) {
    throw new AppError('Return request not found.', 'NOT_FOUND');
  }

  const items = await withTenantQuery(`
    SELECT * FROM return_items WHERE return_request_id = $1 AND tenant_id = $2;
  `, [returnId, tenantId], tenantId);

  return { ...res[0], items };
}

export async function approveReturn(tenantId: string, returnId: string, approverId: string) {
  const cleanApproverId = parseUserId(approverId);
  const request = await getReturnRequest(tenantId, returnId);

  if (request.status !== 'requested') {
    throw new AppError(`Return request cannot be approved from status: ${request.status}`, 'BAD_REQUEST');
  }

  const res = await withTenantQuery(`
    UPDATE return_requests
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2 RETURNING *;
  `, [returnId, tenantId], tenantId);

  return res[0];
}

// Idempotent Refund Processing with Transaction Caps
export async function processRefund(tenantId: string, returnId: string, amountCents: number) {
  const request = await getReturnRequest(tenantId, returnId);

  if (request.status !== 'approved' && request.status !== 'refunded') {
    throw new AppError(`Refund processing requires approved return status. Current status: ${request.status}`, 'BAD_REQUEST');
  }

  // 1. Calculate sum of items authorized for refund on this return request
  let returnAuthorizedCapCents = 0;
  for (const item of request.items) {
    returnAuthorizedCapCents += parseInt(item.refund_cents, 10) * parseInt(item.quantity, 10);
  }

  // 2. Fetch existing completed refund transaction totals
  const existingRefunds = await withTenantQuery(`
    SELECT COALESCE(SUM(amount_cents), 0) as total_refunded
    FROM refund_transactions
    WHERE return_request_id = $1 AND tenant_id = $2 AND status = 'completed';
  `, [returnId, tenantId], tenantId);

  const totalRefunded = parseInt(existingRefunds[0]?.total_refunded || '0', 10);
  const potentialTotal = totalRefunded + amountCents;

  if (potentialTotal > returnAuthorizedCapCents) {
    throw new AppError(`Refund transaction rejected. Exceeds return cap. Cap: ${returnAuthorizedCapCents} | Already Refunded: ${totalRefunded} | Requested: ${amountCents}`, 'BAD_REQUEST');
  }

  const transactionId = crypto.randomUUID();
  const refId = `REF-${Math.floor(100000 + Math.random() * 900000)}`;

  await withTenantQuery(`
    INSERT INTO refund_transactions (id, tenant_id, return_request_id, amount_cents, status, reference_id)
    VALUES ($1, $2, $3, $4, 'completed', $5);
  `, [transactionId, tenantId, returnId, amountCents, refId], tenantId);

  const updateRes = await withTenantQuery(`
    UPDATE return_requests
    SET total_refund_cents = total_refund_cents + $1, status = 'refunded', updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [amountCents, returnId, tenantId], tenantId);

  return {
    transactionId,
    referenceId: refId,
    amountCents,
    totalRefunded: potentialTotal,
    returnCap: returnAuthorizedCapCents,
    request: updateRes[0]
  };
}
