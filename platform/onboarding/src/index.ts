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
  const configPath = path.join(process.cwd(), 'config', 'onboarding.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { multipleFlows: true }, limits: { flowCount: 5, stepsPerFlow: 10 } };
}

export async function createFlow(tenantId: string, createdBy: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Onboarding is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(createdBy);

  if (data.steps.length > cfg.limits.stepsPerFlow) {
    throw new AppError('Steps count limit per flow exceeded', ErrorCode.BAD_REQUEST);
  }

  // Enforce flow count limit inside direct-array queries
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM onboarding_flows WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.flowCount) {
    throw new AppError('Flow definition limits reached', ErrorCode.FORBIDDEN);
  }

  const flowId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO onboarding_flows (id, tenant_id, name, description, target_role, steps, settings)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    flowId, tenantId, data.name, data.description || null, data.target_role || null,
    JSON.stringify(data.steps || []), JSON.stringify(data.settings || {})
  ], tenantId);

  return result[0];
}

export async function startFlow(tenantId: string, userId: string, flowId: string) {
  const cleanUserId = parseUserId(userId);
  const progressId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO onboarding_progress (id, tenant_id, flow_id, user_id, status, last_activity)
    VALUES ($1, $2, $3, $4, 'in_progress', CURRENT_TIMESTAMP)
    ON CONFLICT (flow_id, user_id) DO UPDATE 
    SET status = 'in_progress', last_activity = CURRENT_TIMESTAMP
    RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    progressId, tenantId, flowId, cleanUserId
  ], tenantId);

  return result[0];
}

export async function completeStep(tenantId: string, userId: string, stepId: number) {
  const cleanUserId = parseUserId(userId);

  const progressRes = await withTenantQuery(
    'SELECT * FROM onboarding_progress WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE',
    [tenantId, cleanUserId], tenantId
  );

  const progress = progressRes[0];
  if (!progress) throw new AppError('No active progress workflow found', ErrorCode.NOT_FOUND);

  // Sequenced array append
  const completed = [...new Set([...(progress.completed_steps || []), stepId])];

  const updateQuery = `
    UPDATE onboarding_progress 
    SET completed_steps = $1, current_step = $2, last_activity = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_id = $4 RETURNING *;
  `;
  const result = await withTenantQuery(updateQuery, [
    completed, stepId + 1, progress.id, tenantId
  ], tenantId);

  return result[0];
}
