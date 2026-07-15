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
    const configPath = path.join(process.cwd(), 'config', 'ai-decisions.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 100 } };
}

async function enforceHardenedTier(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.tiers?.humanOverride !== true) {
    throw new AppError('AI Decisions requires the HARDENED tier enabled with Overrides', ErrorCode.FORBIDDEN);
  }
}

export async function createModel(tenantId: string, data: any) {
  await enforceHardenedTier(tenantId);

  const modelId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO decision_models (id, tenant_id, name, rules, weights, thresholds)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    modelId, tenantId, data.name, JSON.stringify(data.rules || []), JSON.stringify(data.weights || {}), JSON.stringify(data.thresholds || {})
  ], tenantId);

  return res[0];
}

export async function evaluate(tenantId: string, userId: string, data: any) {
  await enforceHardenedTier(tenantId);
  const cfg = loadConfig();
  const cleanUserId = parseUserId(userId);

  // Check Monthly Limits
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM decisions WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.decisionsPerMonth) {
    throw new AppError('Monthly evaluated decision limits reached', ErrorCode.RATE_LIMITED);
  }

  // Load Model Rules and Thresholds
  const modelRes = await withTenantQuery('SELECT * FROM decision_models WHERE id = $1 AND tenant_id = $2', [data.modelId, tenantId], tenantId);
  const model = modelRes[0];
  if (!model) throw new AppError('Decision model not found', ErrorCode.NOT_FOUND);

  const rules = model.rules || [];
  const weights = model.weights || {};
  const thresholds = model.thresholds || { pass: 0.7 };

  let totalScore = 0.0;
  let ruleResults: any[] = [];

  for (const rule of rules) {
    const inputValue = data.inputData[rule.field];
    let passed = false;

    if (rule.operator === 'gte') passed = inputValue >= rule.value;
    else if (rule.operator === 'lte') passed = inputValue <= rule.value;
    else if (rule.operator === 'eq') passed = inputValue === rule.value;

    const weight = parseFloat(weights[rule.id] || '1.0');
    totalScore += passed ? weight : 0.0;
    
    ruleResults.push({ rule_id: rule.id, field: rule.field, passed, weight });
  }

  const confidence = rules.length > 0 ? (totalScore / rules.length) : 1.0;
  const outcome = confidence >= parseFloat(thresholds.pass) ? 'pass' : 'fail';
  const reasoning = `Rule engine scored ${Math.round(confidence * 100)}% confidence metrics.`;

  const decisionId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO decisions (id, tenant_id, model_id, input_data, outcome, confidence, rule_results, ai_reasoning, reference_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    decisionId, tenantId, data.modelId, JSON.stringify(data.inputData), outcome, confidence, 
    JSON.stringify(ruleResults), reasoning, data.referenceId || null, cleanUserId
  ], tenantId);

  return result[0];
}

export async function overrideDecision(tenantId: string, decisionId: string, newOutcome: string, reason: string, adminId: string) {
  await enforceHardenedTier(tenantId);
  const cleanAdminId = parseUserId(adminId);

  // Validate decision target exists on read-path
  const decisionRes = await withTenantQuery('SELECT id FROM decisions WHERE id = $1 AND tenant_id = $2', [decisionId, tenantId], tenantId);
  if (decisionRes.length === 0) throw new AppError('Decision not found to override', ErrorCode.NOT_FOUND);

  const overrideId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO decision_overrides (id, tenant_id, decision_id, new_outcome, reason, resolved_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    overrideId, tenantId, decisionId, newOutcome, reason, cleanAdminId
  ], tenantId);

  return result[0];
}

export async function getDecisionDetails(tenantId: string, id: string) {
  await enforceHardenedTier(tenantId);

  const decisionRes = await withTenantQuery('SELECT * FROM decisions WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const decision = decisionRes[0];
  if (!decision) throw new AppError('Decision details not found', ErrorCode.NOT_FOUND);

  const overrides = await withTenantQuery('SELECT id, new_outcome, reason, resolved_by FROM decision_overrides WHERE decision_id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  return { ...decision, overrides };
}
