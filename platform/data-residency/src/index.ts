import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const UpdateResidencyPolicySchema = z.object({
  allowed_regions: z.array(z.string()).min(1).max(10),
  primary_region: z.string(),
  enforcement_mode: z.enum(['enforce', 'audit', 'disabled']).default('enforce'),
});

export const GenerateReportSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'data-residency.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { requestRoutingEnforcement: true, crossRegionDetection: true } };
}

export async function createRegion(tenantId: string, data: any) {
  const regionId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO residency_regions (id, region_code, display_name, jurisdiction)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (region_code) 
    DO UPDATE SET display_name = EXCLUDED.display_name, jurisdiction = EXCLUDED.jurisdiction
    RETURNING *;
  `, [regionId, data.region_code, data.display_name, data.jurisdiction], tenantId);
  return res[0];
}

export async function setResidencyPolicy(tenantId: string, data: any, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Data Residency module is disabled', 'FORBIDDEN');

  const parsed = UpdateResidencyPolicySchema.parse(data);
  const cleanUserId = parseUserId(userId);

  // 1. Fetch active policy state to evaluate audit changelogs
  const existingPolicyRes = await withTenantQuery(`
    SELECT * FROM tenant_residency_policies WHERE tenant_id = $1;
  `, [tenantId], tenantId);

  const existing = existingPolicyRes[0];
  const policyId = existing ? existing.id : crypto.randomUUID();

  // 2. Perform Atomic upsert of the residency rules
  const res = await withTenantQuery(`
    INSERT INTO tenant_residency_policies (id, tenant_id, allowed_regions, primary_region, enforcement_mode, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id) 
    DO UPDATE SET allowed_regions = EXCLUDED.allowed_regions, primary_region = EXCLUDED.primary_region, enforcement_mode = EXCLUDED.enforcement_mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    RETURNING *;
  `, [policyId, tenantId, parsed.allowed_regions, parsed.primary_region, parsed.enforcement_mode, cleanUserId], tenantId);

  // 3. Write append-only policy change logs to the compliance registry
  await withTenantQuery(`
    INSERT INTO residency_policy_history (id, tenant_id, policy_id, previous_allowed_regions, new_allowed_regions, previous_primary_region, new_primary_region, changed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
  `, [crypto.randomUUID(), tenantId, policyId, existing ? existing.allowed_regions : null, parsed.allowed_regions, existing ? existing.primary_region : null, parsed.primary_region, cleanUserId], tenantId);

  return res[0];
}

export async function recordViolation(tenantId: string, violationType: string, requestRegion: string, allowedRegions: string[]) {
  const violationId = crypto.randomUUID();
  const detail = JSON.stringify({ message: `Client connection routed from unauthorized region: ${requestRegion}` });

  await withTenantQuery(`
    INSERT INTO residency_violations (id, tenant_id, violation_type, detected_region, policy_regions, detail)
    VALUES ($1, $2, $3, $4, $5, $6);
  `, [violationId, tenantId, violationType, requestRegion, allowedRegions, detail], tenantId);
}

// Deterministic Request Residency Gate
export async function enforceResidencyGate(tenantId: string, requestRegion: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.requestRoutingEnforcement) return { allowed: true };

  const policyRes = await withTenantQuery(`
    SELECT * FROM tenant_residency_policies WHERE tenant_id = $1;
  `, [tenantId], tenantId);
  const policy = policyRes[0];

  if (!policy || policy.enforcement_mode === 'disabled') return { allowed: true };

  // Convert array representation safely (supports both pg array string representation and standard JS arrays)
  const allowed = Array.isArray(policy.allowed_regions) 
    ? policy.allowed_regions 
    : String(policy.allowed_regions).replace(/{|}/g, '').split(',');

  if (!allowed.includes(requestRegion)) {
    if (policy.enforcement_mode === 'enforce') {
      throw new AppError(`Sovereign Compliance Block: Client request routed from region '${requestRegion}' is denied. Allowed geographic regions: [${allowed.join(', ')}].`, 'FORBIDDEN');
    } else if (policy.enforcement_mode === 'audit') {
      // Append-only log violation entry in background and allow request
      await recordViolation(tenantId, 'cross_region_request', requestRegion, allowed);
      return { allowed: true, audited_violation: true };
    }
  }

  return { allowed: true };
}

export async function getResidencyLedger(tenantId: string) {
  const policyRes = await withTenantQuery(`
    SELECT * FROM tenant_residency_policies WHERE tenant_id = $1;
  `, [tenantId], tenantId);

  const history = await withTenantQuery(`
    SELECT * FROM residency_policy_history WHERE tenant_id = $1 ORDER BY changed_at DESC;
  `, [tenantId], tenantId);

  const violations = await withTenantQuery(`
    SELECT * FROM residency_violations WHERE tenant_id = $1 ORDER BY detected_at DESC;
  `, [tenantId], tenantId);

  return {
    active_policy: policyRes[0] || null,
    history,
    violations
  };
}
