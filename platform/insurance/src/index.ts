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

export const InsuranceConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    policyManagement: z.boolean().default(true),
    claimsSubmission: z.boolean().default(true),
    basicUnderwriting: z.boolean().default(true),
    riskScoring: z.boolean().default(true),
    fraudDetection: z.boolean().default(true),
  }),
  thresholds: z.object({
    autoApproveClaimScore: z.number().default(0.9),
    fraudRiskThreshold: z.number().default(0.75),
  })
});

export type InsuranceConfig = z.infer<typeof InsuranceConfigSchema>;

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig(): InsuranceConfig {
  try {
    const configPath = path.join(process.cwd(), 'config', 'insurance.json');
    if (fs.existsSync(configPath)) {
      return InsuranceConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: { policyManagement: true, claimsSubmission: true, basicUnderwriting: true, riskScoring: true, fraudDetection: true },
    thresholds: { autoApproveClaimScore: 0.9, fraudRiskThreshold: 0.75 }
  };
}

export async function createHolder(tenantId: string, data: any) {
  const holderId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO ins_holders (id, tenant_id, first_name, last_name, email)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [holderId, tenantId, data.first_name, data.last_name, data.email], tenantId);
  return res[0];
}

export async function createPolicy(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Insurance module disabled', 'FORBIDDEN');
  if (!isValidUuid(data.holder_id)) throw new AppError('Invalid Holder ID format.', 'BAD_REQUEST');

  const policyId = crypto.randomUUID();
  const policyNum = `POL-${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Determine start/end date (default to 1 year term)
  const startDate = new Date();
  const endDate = new Date();
  endDate.setFullYear(endDate.getFullYear() + 1);

  let initialStatus = 'active';
  
  // Basic Underwriting Rules: If coverage limit > $1M, require underwriting hold
  if (cfg.tiers.basicUnderwriting && data.coverage_limit > 100000000) {
    initialStatus = 'underwriting';
  }

  const res = await withTenantQuery(`
    INSERT INTO ins_policies (id, tenant_id, holder_id, policy_number, policy_type, premium_cents, coverage_limit, status, start_date, end_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
  `, [policyId, tenantId, data.holder_id, policyNum, data.policy_type, data.premium_cents, data.coverage_limit, initialStatus, startDate.toISOString(), endDate.toISOString()], tenantId);

  return res[0];
}

// Fraud & Risk Actuarial Scoring Engine
export async function calculateClaimRisk(description: string, claimAmount: number, coverageLimit: number): Promise<number> {
  let score = 0.98; // Base high trust score

  // 1. High utilization penalty
  if (claimAmount > (coverageLimit * 0.5)) {
    score -= 0.15; // Claims over 50% of policy limit trigger suspicion
  }

  // 2. Fraud keyword detection
  const fraudKeywords = ['unwitnessed', 'stolen cash', 'lost', 'cash', 'undocumented', 'no receipt'];
  const descLower = description.toLowerCase();
  for (const keyword of fraudKeywords) {
    if (descLower.includes(keyword)) {
      score -= 0.30;
      break;
    }
  }

  return Math.max(0.1, parseFloat(score.toFixed(2)));
}

export async function submitClaim(tenantId: string, input: any) {
  const cfg = loadConfig();
  if (!isValidUuid(input.policy_id)) throw new AppError('Invalid Policy ID format.', 'BAD_REQUEST');

  const policyRes = await withTenantQuery(`
    SELECT * FROM ins_policies WHERE id = $1 AND tenant_id = $2;
  `, [input.policy_id, tenantId], tenantId);
  const policy = policyRes[0];

  if (!policy) throw new AppError('Policy not found.', 'NOT_FOUND');
  if (policy.status !== 'active') throw new AppError('Cannot file claims against inactive policies.', 'BAD_REQUEST');
  if (input.amount_cents > policy.coverage_limit) throw new AppError('Claim exceeds absolute coverage limit.', 'BAD_REQUEST');

  const claimId = crypto.randomUUID();
  const claimNum = `CLM-${Math.floor(100000 + Math.random() * 900000)}`;

  let riskScore = 1.0;
  if (cfg.tiers.riskScoring) {
    riskScore = await calculateClaimRisk(input.description, input.amount_cents, policy.coverage_limit);
  }

  // Adjudication routing logic
  let initialStatus = 'submitted';
  if (riskScore >= cfg.thresholds.autoApproveClaimScore) {
    initialStatus = 'approved';
  } else if (riskScore < cfg.thresholds.fraudRiskThreshold) {
    initialStatus = 'under_review'; // Flags to SIU (Special Investigative Unit)
  }

  const res = await withTenantQuery(`
    INSERT INTO ins_claims (id, tenant_id, policy_id, claim_number, incident_date, description, amount_cents, risk_score, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `, [claimId, tenantId, input.policy_id, claimNum, input.incident_date, input.description, input.amount_cents, riskScore, initialStatus], tenantId);

  return res[0];
}

export async function getPolicyLedger(tenantId: string, policyId: string) {
  if (!isValidUuid(policyId)) throw new AppError('Invalid Policy ID format.', 'BAD_REQUEST');

  const policyRes = await withTenantQuery(`
    SELECT p.*, h.first_name, h.last_name, h.email, h.risk_profile
    FROM ins_policies p
    JOIN ins_holders h ON p.holder_id = h.id
    WHERE p.id = $1 AND p.tenant_id = $2;
  `, [policyId, tenantId], tenantId);

  const policy = policyRes[0];
  if (!policy) throw new AppError('Policy not found.', 'NOT_FOUND');

  const claims = await withTenantQuery(`
    SELECT * FROM ins_claims WHERE policy_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [policyId, tenantId], tenantId);

  return { ...policy, claims };
}
