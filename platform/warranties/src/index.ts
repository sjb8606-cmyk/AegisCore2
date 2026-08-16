import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const WarrantiesConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    warrantyRegistration: z.boolean().default(true),
    claimSubmission: z.boolean().default(true),
    coverageRulesEngine: z.boolean().default(true),
    basicRepairWorkflow: z.boolean().default(true),
    replacementWorkflow: z.boolean().default(true),
    expirationTracking: z.boolean().default(true),
    serviceDispatch: z.boolean().default(false),
    advancedSlaTracking: z.boolean().default(false),
    fraudDetection: z.boolean().default(false),
    manufacturerIntegration: z.boolean().default(false),
    warrantyExtensions: z.boolean().default(false),
    bulkProcessing: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    predictiveFailureAnalytics: z.boolean().default(false),
  }),
  limits: z.object({
    warrantiesPerTenant: z.number().default(10000000),
    claimsPerMonth: z.number().default(500000),
    coverageRules: z.number().default(5000),
    serviceTickets: z.number().default(1000000),
  }),
  thresholds: z.object({
    autoApproveClaimScore: z.number().default(0.85),
    manualReviewClaimScore: z.number().default(0.6),
    fraudRiskScore: z.number().default(0.7),
    slaRepairDays: z.number().default(7),
  }),
});

export type WarrantiesConfig = z.infer<typeof WarrantiesConfigSchema>;

function loadConfig(): WarrantiesConfig {
  const configPath = path.join(process.cwd(), 'config', 'warranties.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return WarrantiesConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: {
      warrantyRegistration: true,
      claimSubmission: true,
      coverageRulesEngine: true,
      basicRepairWorkflow: true,
      replacementWorkflow: true,
      expirationTracking: true,
      serviceDispatch: true,
      advancedSlaTracking: false,
      fraudDetection: true,
      manufacturerIntegration: false,
      warrantyExtensions: false,
      bulkProcessing: false,
      auditTrail: true,
      predictiveFailureAnalytics: false
    },
    limits: { warrantiesPerTenant: 10000000, claimsPerMonth: 500000, coverageRules: 5000, serviceTickets: 1000000 },
    thresholds: { autoApproveClaimScore: 0.85, manualReviewClaimScore: 0.6, fraudRiskScore: 0.7, slaRepairDays: 7 }
  };
}

export async function registerWarranty(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Warranties module disabled', 'FORBIDDEN');

  const warrantyId = crypto.randomUUID();
  const startDate = new Date();
  
  // Set default expiration date to exactly 1 year from purchase
  const endDate = new Date();
  endDate.setFullYear(endDate.getFullYear() + 1);

  const res = await withTenantQuery(`
    INSERT INTO saas_warranties (id, tenant_id, product_id, customer_id, serial_number, purchase_id, end_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [warrantyId, tenantId, data.product_id, data.customer_id, data.serial_number || null, data.purchase_id || null, endDate.toISOString()], tenantId);

  return res[0];
}

// Deterministic Claim Evaluation Engine
export async function evaluateClaimScore(issueDescription: string, severity: number): Promise<number> {
  let baseScore = 0.95; // Assume highly valid initially

  // Rule 1: High severity requests pull the score down to trigger manual audit verification
  if (severity > 3) {
    baseScore -= 0.15;
  }

  // Rule 2: Accidental damage keywords flag review (accidental drops/cracks are void under default terms)
  const accidentalKeywords = ['dropped', 'water', 'liquid', 'spill', 'cracked', 'accident'];
  const descLower = issueDescription.toLowerCase();
  for (const keyword of accidentalKeywords) {
    if (descLower.includes(keyword)) {
      baseScore -= 0.35;
      break;
    }
  }

  return Math.max(0.1, parseFloat(baseScore.toFixed(2)));
}

export async function submitClaim(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Warranties module disabled', 'FORBIDDEN');
  if (!isValidUuid(data.warranty_id)) throw new AppError('Invalid Warranty ID format.', 'BAD_REQUEST');

  // Verify active warranty exists
  const warrantyRes = await withTenantQuery(`
    SELECT * FROM saas_warranties WHERE id = $1 AND tenant_id = $2 AND status = 'active';
  `, [data.warranty_id, tenantId], tenantId);

  if (!warrantyRes || warrantyRes.length === 0) {
    throw new AppError('Active warranty contract not found.', 'NOT_FOUND');
  }

  const claimId = crypto.randomUUID();
  const severity = data.severity || 1;
  const score = await evaluateClaimScore(data.issue_description, severity);

  // Status mapping based on deterministic rules score evaluation
  const status = score >= cfg.thresholds.autoApproveClaimScore ? 'approved' : 'under_review';

  const res = await withTenantQuery(`
    INSERT INTO saas_claims (id, tenant_id, warranty_id, issue_description, severity, claim_score, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [claimId, tenantId, data.warranty_id, data.issue_description, severity, score, status], tenantId);

  const claim = res[0];

  // Service Dispatch Workflow: Automate repair dispatch for auto-approved coverage claims
  if (status === 'approved' && cfg.tiers.serviceDispatch) {
    const ticketId = crypto.randomUUID();
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + 2); // Schedule 2 days out

    await withTenantQuery(`
      INSERT INTO saas_service_tickets (id, tenant_id, claim_id, technician_name, scheduled_at)
      VALUES ($1, $2, $3, $4, $5);
    `, [ticketId, tenantId, claimId, 'Technician John Doe', scheduledDate.toISOString()], tenantId);
  }

  return claim;
}

export async function getWarrantyLedger(tenantId: string, warrantyId: string) {
  if (!isValidUuid(warrantyId)) throw new AppError('Invalid Warranty ID format.', 'BAD_REQUEST');

  const warrantyRes = await withTenantQuery(`
    SELECT * FROM saas_warranties WHERE id = $1 AND tenant_id = $2;
  `, [warrantyId, tenantId], tenantId);

  if (!warrantyRes || warrantyRes.length === 0) {
    throw new AppError('Warranty contract not found.', 'NOT_FOUND');
  }

  const claims = await withTenantQuery(`
    SELECT * FROM saas_claims WHERE warranty_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [warrantyId, tenantId], tenantId);

  for (const claim of claims) {
    const tickets = await withTenantQuery(`
      SELECT * FROM saas_service_tickets WHERE claim_id = $1 AND tenant_id = $2;
    `, [claim.id, tenantId], tenantId);
    claim.service_tickets = tickets;
  }

  return {
    ...warrantyRes[0],
    claims
  };
}
