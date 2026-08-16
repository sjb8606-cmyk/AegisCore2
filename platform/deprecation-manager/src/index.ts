import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const DeprecationRuleSchema = z.object({
  surface_name: z.string().min(1),
  deprecated_at: z.string().datetime(),
  hard_cutoff_at: z.string().datetime(),
  grace_days_override: z.number().int().nonnegative().default(0),
  migration_guide_url: z.string().url().optional(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'deprecation-manager.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { enforceRemovalGate: true, usageTracking: true } };
}

export async function createDeprecationRule(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Deprecation Manager is disabled', 'FORBIDDEN');

  const parsed = DeprecationRuleSchema.parse(data);
  const ruleId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO dep_rules (id, tenant_id, surface_name, deprecated_at, hard_cutoff_at, grace_days_override, migration_guide_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [ruleId, tenantId, parsed.surface_name, parsed.deprecated_at, parsed.hard_cutoff_at, parsed.grace_days_override, parsed.migration_guide_url || null], tenantId);

  return res[0];
}

// Append-only usage events logger
export async function logUsageEvent(tenantId: string, ruleId: string, clientFingerprint: string, payloadSizeBytes: number) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.usageTracking) {
    throw new AppError('Deprecation usage tracking tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(ruleId)) throw new AppError('Invalid Rule ID format.', 'BAD_REQUEST');

  const eventId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO dep_usage_events (id, tenant_id, rule_id, client_fingerprint, payload_size_bytes)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [eventId, tenantId, ruleId, clientFingerprint, payloadSizeBytes], tenantId);

  return res[0];
}

// Deterministic Deprecation & Removal Gate
export async function evaluateEnforcementGate(tenantId: string, surfaceName: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { allowed: true };

  const ruleRes = await withTenantQuery(`
    SELECT * FROM dep_rules WHERE surface_name = $1 AND tenant_id = $2;
  `, [surfaceName, tenantId], tenantId);

  const rule = ruleRes[0];
  if (!rule) return { allowed: true }; // No active deprecation rules for this endpoint

  const now = new Date();
  
  // Calculate cutoff date incorporating grace period overrides
  const cutoff = new Date(rule.hard_cutoff_at);
  const graceDays = parseInt(rule.grace_days_override, 10);
  cutoff.setDate(cutoff.getDate() + graceDays);

  const deprecatedAt = new Date(rule.deprecated_at);

  // Status Check #1: Hard Cutoff Passed -> Block completely with GONE (410)
  if (cfg.tiers.enforceRemovalGate && now > cutoff) {
    throw new AppError(`Deprecation Block: This surface was fully deprecated on ${deprecatedAt.toISOString()} and removed on ${cutoff.toISOString()}. Please migrate immediately using this guide: ${rule.migration_guide_url}`, 'GONE');
  }

  // Status Check #2: Currently in Deprecation Grace Window -> Allow but warn
  if (now > deprecatedAt) {
    return {
      allowed: true,
      warning: true,
      deprecated_at: rule.deprecated_at,
      hard_cutoff_at: cutoff.toISOString(),
      migration_guide_url: rule.migration_guide_url
    };
  }

  return { allowed: true };
}

export async function getDeprecationLedger(tenantId: string, ruleId: string) {
  if (!isValidUuid(ruleId)) throw new AppError('Invalid Rule ID format.', 'BAD_REQUEST');

  const ruleRes = await withTenantQuery(`
    SELECT * FROM dep_rules WHERE id = $1 AND tenant_id = $2;
  `, [ruleId, tenantId], tenantId);
  const rule = ruleRes[0];
  if (!rule) throw new AppError('Deprecation rule not found.', 'NOT_FOUND');

  const events = await withTenantQuery(`
    SELECT * FROM dep_usage_events WHERE rule_id = $1 AND tenant_id = $2 ORDER BY called_at DESC;
  `, [ruleId, tenantId], tenantId);

  return {
    ...rule,
    usage_history: events
  };
}
