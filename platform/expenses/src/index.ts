import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

export const ExpensesConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    expenseSubmission: z.boolean().default(true),
    receiptUpload: z.boolean().default(true),
    ocrExtraction: z.boolean().default(true),
    approvalWorkflow: z.boolean().default(true),
    reimbursements: z.boolean().default(true),
    mileageTracking: z.boolean().default(false),
    corporateCardMatching: z.boolean().default(false),
    policyEnforcement: z.boolean().default(false),
    multiCurrency: z.boolean().default(false),
    fraudDetection: z.boolean().default(false),
    bulkImports: z.boolean().default(false),
    advancedAnalytics: z.boolean().default(false),
    auditTrail: z.boolean().default(false),
    erpExports: z.boolean().default(false),
    recurringExpenses: z.boolean().default(false),
  }),
  limits: z.object({
    expensesPerMonth: z.number().default(25000),
    receiptFileSizeMb: z.number().default(25),
    approvalStages: z.number().default(5),
    reimbursementWindowDays: z.number().default(90),
  }),
  thresholds: z.object({
    autoApprovalAmount: z.number().default(100),
    managerApprovalAmount: z.number().default(1000),
    executiveApprovalAmount: z.number().default(10000),
  }),
});

export type ExpensesConfig = z.infer<typeof ExpensesConfigSchema>;

export interface ExpenseReportInput {
  title: string;
  description?: string;
  items: ExpenseItemInput[];
}

export interface ExpenseItemInput {
  category: string;
  merchantName?: string;
  expenseDate: string;
  amount: number;
  receiptFileId?: string;
}

function loadConfig(): ExpensesConfig {
  const configPath = path.join(process.cwd(), 'config', 'expenses.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return ExpensesConfigSchema.parse(raw);
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return ExpensesConfigSchema.parse({
    enabled: true,
    tiers: { auditTrail: true, approvalWorkflow: true },
    limits: { expensesPerMonth: 25000 },
    thresholds: { autoApprovalAmount: 100, managerApprovalAmount: 1000, executiveApprovalAmount: 10000 }
  });
}

async function generateExpenseReportNumber(tenantId: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery("SELECT COUNT(*) as seq FROM expense_reports WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE", [tenantId], tenantId);
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `EXP-${date}-${seq}`;
}

export async function createExpenseReport(tenantId: string, userId: string, data: ExpenseReportInput) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Expenses vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM expense_reports WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.expensesPerMonth) {
    throw new AppError('Monthly expense limits reached', ErrorCode.RATE_LIMITED);
  }

  const reportNumber = await generateExpenseReportNumber(tenantId);
  const reportId = crypto.randomUUID();

  // 1. Insert Expense Report Header
  const insertReport = `
    INSERT INTO expense_reports (id, tenant_id, report_number, title, description, employee_id)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertReport, [
    reportId, tenantId, reportNumber, data.title, data.description || null, cleanUserId
  ], tenantId);

  // 2. Insert Items & Sum Total Cents
  let totalCents = 0;
  const items = data.items || [];
  for (const item of items) {
    totalCents += item.amount;
    const itemId = crypto.randomUUID();
    const receiptId = item.receiptFileId ? parseUserId(item.receiptFileId) : null;

    await withTenantQuery(`
      INSERT INTO expense_items (id, tenant_id, report_id, category, merchant_name, expense_date, amount_cents, receipt_file_id)
      VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8);
    `, [itemId, tenantId, reportId, item.category, item.merchantName || null, item.expenseDate, item.amount, receiptId], tenantId);
  }

  // 3. Update total sum in Expense Header
  await withTenantQuery('UPDATE expense_reports SET total_cents = $1 WHERE id = $2 AND tenant_id = $3', [totalCents, reportId, tenantId], tenantId);

  return { ...result[0], total_cents: totalCents };
}

export async function submitExpenseReport(tenantId: string, reportId: string, userId: string) {
  const cleanUserId = parseUserId(userId);

  // Check state is draft
  const reportRes = await withTenantQuery('SELECT status FROM expense_reports WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [reportId, tenantId], tenantId);
  if (!reportRes[0]) throw new AppError('Expense report not found', ErrorCode.NOT_FOUND);
  if (reportRes[0].status !== 'draft') throw new AppError('Only draft expense reports can be submitted', ErrorCode.BAD_REQUEST);

  // Atomically transition status to submitted
  await withTenantQuery('UPDATE expense_reports SET status = \'submitted\', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2', [reportId, tenantId], tenantId);

  // NOTE: no approval row is pre-created here — see approveExpenseReport() below.
  return { success: true, status: 'submitted' };
}

export async function approveExpenseReport(tenantId: string, reportId: string, approverId: string, reason: string) {
  const cleanApproverId = parseUserId(approverId);

  // Verify status is submitted
  const reportRes = await withTenantQuery('SELECT status FROM expense_reports WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [reportId, tenantId], tenantId);
  if (!reportRes[0]) throw new AppError('Expense report not found', ErrorCode.NOT_FOUND);
  if (reportRes[0].status !== 'submitted') throw new AppError('Report is not pending review', ErrorCode.BAD_REQUEST);

  const approvalId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO expense_approvals (id, tenant_id, report_id, approver_id, status, reason, resolved_at)
    VALUES ($1, $2, $3, $4, 'approved', $5, CURRENT_TIMESTAMP);
  `, [approvalId, tenantId, reportId, cleanApproverId, reason], tenantId);

  await withTenantQuery(`
    UPDATE expense_reports 
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [reportId, tenantId], tenantId);

  return { success: true };
}

export async function getExpenseDetails(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM expense_reports WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const report = res[0];
  if (!report) throw new AppError('Expense report not found', ErrorCode.NOT_FOUND);

  const items = await withTenantQuery('SELECT id, category, merchant_name, expense_date, amount_cents FROM expense_items WHERE report_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const approvals = await withTenantQuery('SELECT id, status, reason, resolved_at FROM expense_approvals WHERE report_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);

  return { ...report, items, approvals };
}
