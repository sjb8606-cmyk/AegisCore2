import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-agents.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { hitlGating: true }, limits: { maxStepsPerRun: 10 } };
}

async function enforceHardenedTier(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.tiers?.hitlGating !== true) {
    throw new AppError('AI Agents require the HARDENED tier enabled with HITL', ErrorCode.FORBIDDEN);
  }
}

export async function createAgentDefinition(tenantId: string, data: any) {
  await enforceHardenedTier(tenantId);

  const definitionId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO agent_definitions (id, tenant_id, name, description, system_prompt)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    definitionId, tenantId, data.name, data.description || null, data.system_prompt || null
  ], tenantId);

  return res[0];
}

export async function initiateRun(tenantId: string, agentId: string, input: string, userId: string) {
  await enforceHardenedTier(tenantId);
  const cleanUserId = parseUserId(userId);

  const runId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO agent_runs (id, tenant_id, agent_id, status, input, created_by)
    VALUES ($1, $2, $3, 'waiting_approval', $4, $5) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    runId, tenantId, agentId, input, cleanUserId
  ], tenantId);

  // Generate the mock approval ticket required to unlock the sequence
  const approvalId = crypto.randomUUID();
  const actionPayload = {
    action: "execute_payout",
    amount_usd: 1250,
    target_wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
  };

  await withTenantQuery(`
    INSERT INTO agent_approvals (id, tenant_id, run_id, step_number, action_payload)
    VALUES ($1, $2, $3, 1, $4);
  `, [approvalId, tenantId, runId, JSON.stringify(actionPayload)], tenantId);

  return result[0];
}

export async function resolveApproval(tenantId: string, approvalId: string, approved: boolean, userId: string) {
  await enforceHardenedTier(tenantId);
  const cleanUserId = parseUserId(userId);

  // Atomic locked lookup of the HITL ticket
  const approvalRes = await withTenantQuery(`
    SELECT * FROM agent_approvals WHERE id = $1 AND tenant_id = $2 FOR UPDATE;
  `, [approvalId, tenantId], tenantId);
  
  const approval = approvalRes[0];
  if (!approval) throw new AppError('HITL approval ticket not found', ErrorCode.NOT_FOUND);
  if (approval.status !== 'pending') throw new AppError('HITL ticket has already been resolved', ErrorCode.BAD_REQUEST);

  const nextStatus = approved ? 'approved' : 'rejected';
  const runStatus = approved ? 'completed' : 'failed';

  await withTenantQuery(`
    UPDATE agent_approvals 
    SET status = $1, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
    WHERE id = $3 AND tenant_id = $4;
  `, [nextStatus, cleanUserId, approvalId, tenantId], tenantId);

  await withTenantQuery(`
    UPDATE agent_runs 
    SET status = $1, current_step = current_step + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_id = $3;
  `, [runStatus, approval.run_id, tenantId], tenantId);

  return { success: true, action: nextStatus, run_status: runStatus };
}

export async function getRunDetails(tenantId: string, id: string) {
  await enforceHardenedTier(tenantId);

  const runRes = await withTenantQuery('SELECT * FROM agent_runs WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const run = runRes[0];
  if (!run) throw new AppError('Agent run not found', ErrorCode.NOT_FOUND);

  const approvals = await withTenantQuery('SELECT id, status, action_payload FROM agent_approvals WHERE run_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  return { ...run, pending_approvals: approvals };
}
