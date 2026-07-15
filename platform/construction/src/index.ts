import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'construction.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { changeOrders: true }, limits: { projectCount: 25 } };
}

export async function createProject(tenantId: string, data: any, managerId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Construction disabled', ErrorCode.FORBIDDEN);

  const cleanManagerId = parseUserId(managerId);
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM construction_projects WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.projectCount) {
    throw new AppError('Project limit reached', ErrorCode.FORBIDDEN);
  }

  const year = new Date().getFullYear();
  const seqRes = await withTenantQuery(
    `SELECT COUNT(*) as seq FROM construction_projects WHERE tenant_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [tenantId, year], tenantId
  );
  const seq = (parseInt(seqRes[0]?.seq || '0', 10) + 1).toString().padStart(3, '0');
  const jobNumber = `${year}-${seq}`;

  const projectId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO construction_projects (id, tenant_id, job_number, client_name, client_email, client_phone, address, description, type, contract_cents, budget_cents, project_manager)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    projectId, tenantId, jobNumber, data.client_name, data.client_email || null, data.client_phone || null,
    JSON.stringify(data.address || {}), data.description || null, data.type || null, 
    data.contract_cents || 0, data.budget_cents || 0, cleanManagerId
  ], tenantId);

  return res[0];
}

export async function addCostItem(tenantId: string, projectId: string, data: any, createdBy: string) {
  const cleanUserId = parseUserId(createdBy);
  const quantity = data.quantity || 1;
  const totalCents = Math.round(quantity * data.unit_cost_cents);
  const costId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO cost_items (id, tenant_id, project_id, category, description, type, quantity, unit, unit_cost_cents, total_cents, actual_cents, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
  `, [costId, tenantId, projectId, data.category, data.description, data.type || 'material', quantity, data.unit || null, data.unit_cost_cents, totalCents, data.actual_cents || totalCents, cleanUserId], tenantId);

  await withTenantQuery('UPDATE construction_projects SET cost_cents = cost_cents + $1 WHERE id = $2 AND tenant_id = $3', [totalCents, projectId, tenantId], tenantId);
  return res[0];
}

export async function createChangeOrder(tenantId: string, projectId: string, data: any) {
  const coId = crypto.randomUUID();
  const coNumber = `CO-${Math.floor(1000 + Math.random() * 9000)}`;
  const res = await withTenantQuery(`
    INSERT INTO change_orders (id, tenant_id, project_id, co_number, title, description, amount_cents, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *;
  `, [coId, tenantId, projectId, coNumber, data.title, data.description || null, data.amount_cents], tenantId);
  return res[0];
}

export async function approveChangeOrder(tenantId: string, changeOrderId: string, approverId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.changeOrders) throw new AppError('Change orders disabled', ErrorCode.FORBIDDEN);

  const coRes = await withTenantQuery('SELECT * FROM change_orders WHERE id = $1 AND tenant_id = $2', [changeOrderId, tenantId], tenantId);
  const co = coRes[0];
  if (!co) throw new AppError('Change order not found', ErrorCode.NOT_FOUND);
  if (co.status === 'approved') throw new AppError('Already approved', ErrorCode.BAD_REQUEST);

  await withTenantQuery(`UPDATE change_orders SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = $1 WHERE id = $2 AND tenant_id = $3`, [approverId, changeOrderId, tenantId], tenantId);
  await withTenantQuery(`UPDATE construction_projects SET contract_cents = contract_cents + $1 WHERE id = $2 AND tenant_id = $3`, [co.amount_cents, co.project_id, tenantId], tenantId);

  return { success: true, updated_contract_cents: co.amount_cents };
}

export async function getWipReport(tenantId: string) {
  const res = await withTenantQuery(`
    SELECT id, job_number, client_name, contract_cents, billed_cents, cost_cents, 
           ROUND((billed_cents::numeric / NULLIF(contract_cents, 0)) * 100, 2) as percent_billed
    FROM construction_projects
    WHERE tenant_id = $1 AND status IN ('active','estimate')
    ORDER BY job_number
  `, [tenantId], tenantId);
  return res;
}
