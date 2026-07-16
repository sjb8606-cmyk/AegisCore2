import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';

export const BudgetingConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    departmentBudgets: z.boolean().default(true),
    projectBudgets: z.boolean().default(true),
    forecasting: z.boolean().default(true),
    varianceTracking: z.boolean().default(true),
    budgetApprovals: z.boolean().default(true),
    scenarioPlanning: z.boolean().default(false),
    rollingForecasts: z.boolean().default(false),
    allocationModels: z.boolean().default(false),
    spendControls: z.boolean().default(false),
    budgetLocking: z.boolean().default(false),
    financialSnapshots: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    bulkImports: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    aiForecasting: z.boolean().default(false),
  }),
  limits: z.object({
    budgets: z.number().default(50000),
    budgetVersions: z.number().default(100),
    forecastPeriods: z.number().default(120),
    allocationRules: z.number().default(1000),
  }),
  thresholds: z.object({
    warningVariancePercent: z.number().default(10),
    criticalVariancePercent: z.number().default(25),
    approvalThresholdAmount: z.number().default(10000),
  }),
});

export type BudgetingConfig = z.infer<typeof BudgetingConfigSchema>;

export interface BudgetInput {
  name: string;
  budgetType: 'department' | 'project' | 'operational' | 'capital';
  departmentId?: string;
  projectId?: string;
  fiscalYear: number;
  totalBudget: number;
  lineItems?: BudgetLineItemInput[];
}

export interface BudgetLineItemInput {
  name: string;
  amountCents: number;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig(): BudgetingConfig {
  const configPath = path.join(process.cwd(), 'config', 'budgeting.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return BudgetingConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return BudgetingConfigSchema.parse({
    enabled: true,
    tiers: { financialSnapshots: true, budgetApprovals: true, budgetLocking: true },
    limits: { budgets: 50000 },
    thresholds: { warningVariancePercent: 10, criticalVariancePercent: 25, approvalThresholdAmount: 10000 }
  });
}

async function generateBudgetCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const res = await withTenantQuery("SELECT COUNT(*) as seq FROM budgets WHERE tenant_id = $1 AND EXTRACT(YEAR FROM created_at) = $2", [tenantId, year], tenantId);
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `BDG-${year}-${seq}`;
}

export async function createBudget(tenantId: string, userId: string, data: BudgetInput) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Budgeting vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM budgets WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.budgets) {
    throw new AppError('Monthly budgeting limits reached', ErrorCode.RATE_LIMITED);
  }

  const budgetCode = await generateBudgetCode(tenantId);
  const budgetId = crypto.randomUUID();

  // 1. Insert Budget Header
  const insertQuery = `
    INSERT INTO budgets (id, tenant_id, budget_code, name, budget_type, fiscal_year, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    budgetId, tenantId, budgetCode, data.name, data.budgetType, data.fiscalYear, cleanUserId
  ], tenantId);

  // 2. Insert Lines & Sum Total Cents
  let totalCents = 0;
  const items = data.lineItems || [];
  for (const item of items) {
    totalCents += item.amountCents;
    const itemId = crypto.randomUUID();

    await withTenantQuery(`
      INSERT INTO budget_lines (id, tenant_id, budget_id, name, amount_cents)
      VALUES ($1, $2, $3, $4, $5);
    `, [itemId, tenantId, budgetId, item.name, item.amountCents], tenantId);
  }

  // 3. Update total sum in Budget Header
  await withTenantQuery('UPDATE budgets SET total_budget_cents = $1 WHERE id = $2 AND tenant_id = $3', [totalCents, budgetId, tenantId], tenantId);

  return { ...result[0], total_budget_cents: totalCents };
}

export async function submitBudget(tenantId: string, budgetId: string, submittedBy: string) {
  // Check state is draft
  const budgetRes = await withTenantQuery('SELECT status FROM budgets WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [budgetId, tenantId], tenantId);
  if (!budgetRes[0]) throw new AppError('Budget not found', ErrorCode.NOT_FOUND);
  if (budgetRes[0].status !== 'draft') throw new AppError('Only draft budgets can be submitted', ErrorCode.BAD_REQUEST);

  // Atomically transition status to submitted
  await withTenantQuery('UPDATE budgets SET status = \'submitted\', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2', [budgetId, tenantId], tenantId);

  // Spawns pending approval task
  const approvalId = crypto.randomUUID();
  const approverId = '00000000-0000-0000-0000-000000000001'; // designated financial controller
  
  await withTenantQuery(`
    INSERT INTO budget_approvals (id, tenant_id, budget_id, approver_id, status)
    VALUES ($1, $2, $3, $4, 'pending');
  `, [approvalId, tenantId, budgetId, approverId], tenantId);

  return { success: true, status: 'submitted', approval_id: approvalId };
}

export async function lockBudget(tenantId: string, budgetId: string, adminId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.budgetLocking) throw new AppError('Budget locking disabled', ErrorCode.FORBIDDEN);

  const cleanAdminId = parseUserId(adminId);

  // Reconcile and Lock atomically
  const budgetRes = await withTenantQuery('SELECT * FROM budgets WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [budgetId, tenantId], tenantId);
  const budget = budgetRes[0];
  if (!budget) throw new AppError('Budget not found to lock', ErrorCode.NOT_FOUND);

  // Set status to locked
  const updatedBudget = await withTenantQuery(`
    UPDATE budgets SET status = 'locked', updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND tenant_id = $2 RETURNING *;
  `, [budgetId, tenantId], tenantId);

  // Save immutable snapshot version
  if (cfg.tiers.financialSnapshots) {
    const versionId = crypto.randomUUID();
    const lines = await withTenantQuery('SELECT name, amount_cents FROM budget_lines WHERE budget_id = $1 AND tenant_id = $2', [budgetId, tenantId], tenantId);
    const snapshot = { ...updatedBudget[0], lines };
    
    await withTenantQuery(`
      INSERT INTO budget_versions (id, tenant_id, budget_id, version_number, snapshot)
      VALUES ($1, $2, $3, 1, $4);
    `, [versionId, tenantId, budgetId, JSON.stringify(snapshot)], tenantId);
  }

  return { success: true, budget: updatedBudget[0] };
}

export async function getBudgetDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM budgets WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const report = res[0];
  if (!report) throw new AppError('Budget details not found', ErrorCode.NOT_FOUND);

  const lines = await withTenantQuery('SELECT id, name, amount_cents FROM budget_lines WHERE budget_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const approvals = await withTenantQuery('SELECT id, status, reason, resolved_at FROM budget_approvals WHERE budget_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const versions = await withTenantQuery('SELECT id, version_number, snapshot, created_at FROM budget_versions WHERE budget_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);

  return { ...report, lines, approvals, versions };
}
