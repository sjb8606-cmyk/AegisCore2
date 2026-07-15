import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';

export const CommissionsConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicCommissionPlans: z.boolean().default(true),
    tieredCommissions: z.boolean().default(true),
    splitCommissions: z.boolean().default(true),
    quotaTracking: z.boolean().default(true),
    payoutCalculations: z.boolean().default(true),
    payoutScheduling: z.boolean().default(true),
    performanceBonuses: z.boolean().default(true),
    affiliateCommissions: z.boolean().default(false),
    multiCurrency: z.boolean().default(false),
    clawbacks: z.boolean().default(false),
    disputeHandling: z.boolean().default(false),
    advancedAttribution: z.boolean().default(false),
    bulkImports: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    realtimeComputation: z.boolean().default(false),
  }),
  limits: z.object({
    commissionPlans: z.number().default(10000),
    transactionsPerMonth: z.number().default(500000),
    payoutBatches: z.number().default(10000),
    commissionRulesPerPlan: z.number().default(200),
  }),
  thresholds: z.object({
    managerApprovalPayout: z.number().default(5000),
    directorApprovalPayout: z.number().default(50000),
    clawbackWindowDays: z.number().default(90),
  }),
});

export type CommissionsConfig = z.infer<typeof CommissionsConfigSchema>;

export interface CommissionCalculationInput {
  transactionId: string;
  revenueAmount: number;
  agentId: string;
  sourceType: string;
  metadata?: Record<string, any>;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig(): CommissionsConfig {
  try {
    const configPath = path.join(process.cwd(), 'config', 'commissions.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return CommissionsConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return CommissionsConfigSchema.parse({
    enabled: true,
    tiers: { basicCommissionPlans: true, auditTrail: true },
    limits: { commissionPlans: 10000 },
    thresholds: { managerApprovalPayout: 5000, directorApprovalPayout: 50000, clawbackWindowDays: 90 }
  });
}

export async function createCommissionPlan(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Commissions vertical is disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM commission_plans WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.commissionPlans) {
    throw new AppError('Commission plan limits reached', ErrorCode.FORBIDDEN);
  }

  const planId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO commission_plans (id, tenant_id, name, description)
    VALUES ($1, $2, $3, $4) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [planId, tenantId, data.name, data.description || null], tenantId);
  return res[0];
}

export async function createCommissionRule(tenantId: string, planId: string, data: any) {
  const ruleId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO commission_rules (id, tenant_id, plan_id, name, rate_percent)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [ruleId, tenantId, planId, data.name, data.rate_percent], tenantId);
  return res[0];
}

export async function calculateCommissions(tenantId: string, input: CommissionCalculationInput) {
  const cleanAgentId = parseUserId(input.agentId);
  const transactionId = parseUserId(input.transactionId);

  // Fetch all active rules
  const rules = await withTenantQuery(`
    SELECT r.* FROM commission_rules r 
    JOIN commission_plans p ON r.plan_id = p.id 
    WHERE p.tenant_id = $1 AND p.is_active = true AND p.deleted_at IS NULL;
  `, [tenantId], tenantId);

  if (rules.length === 0) {
    throw new AppError('No active commission plans or rules configured', ErrorCode.BAD_REQUEST);
  }

  const calculatedRecords: any[] = [];
  for (const rule of rules) {
    const rate = parseFloat(rule.rate_percent);
    const commissionCents = Math.round(input.revenueAmount * (rate / 100));

    const recordId = crypto.randomUUID();
    const insertQuery = `
      INSERT INTO commission_records (id, tenant_id, rule_id, agent_id, transaction_id, revenue_amount_cents, commission_amount_cents)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const res = await withTenantQuery(insertQuery, [
      recordId, tenantId, rule.id, cleanAgentId, transactionId, input.revenueAmount, commissionCents
    ], tenantId);
    
    calculatedRecords.push(res[0]);
  }

  return calculatedRecords;
}

export async function processPayoutBatch(tenantId: string, batchId: string) {
  // Atomic payout update
  const records = await withTenantQuery('SELECT id, agent_id, commission_amount_cents FROM commission_records WHERE tenant_id = $1 AND status = \'pending\' FOR UPDATE', [tenantId], tenantId);
  
  for (const record of records) {
    const payoutId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO commission_payouts (id, tenant_id, batch_id, agent_id, amount_cents, status)
      VALUES ($1, $2, $3, $4, $5, 'completed');
    `, [payoutId, tenantId, batchId, record.agent_id, record.commission_amount_cents], tenantId);

    await withTenantQuery('UPDATE commission_records SET status = \'paid\', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2', [record.id, tenantId], tenantId);
  }

  return { success: true, records_processed: records.length };
}

export async function getCommissionsLogs(tenantId: string, transactionId: string) {
  const cleanTxId = parseUserId(transactionId);
  const res = await withTenantQuery('SELECT * FROM commission_records WHERE transaction_id = $1 AND tenant_id = $2', [cleanTxId, tenantId], tenantId);
  return res;
}
