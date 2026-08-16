import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const CreateFlagSchema = z.object({
  key: z.string().min(1).max(255),
  name: z.string().min(1),
  description: z.string().optional(),
  flag_type: z.enum(['boolean', 'string', 'number', 'json']),
  default_value: z.any(),
  status: z.enum(['draft', 'active', 'archived', 'killed']).default('active'),
  environment: z.enum(['development', 'staging', 'production', 'all']).default('all'),
});

export const EvaluateContextSchema = z.object({
  userId: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  attributes: z.record(z.any()).optional(),
});

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'feature-flags.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true };
}

function evaluatePercentageRollout(flagKey: string, identifier: string, rolloutPercentage: number): boolean {
  const hash = crypto.createHash('sha256').update(`${flagKey}:${identifier}`).digest('hex');
  const decimal = parseInt(hash.substring(0, 8), 16);
  return (decimal % 100) < rolloutPercentage;
}

export async function createFlag(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Feature Flags disabled', 'FORBIDDEN');

  const parsed = CreateFlagSchema.parse(data);
  const flagId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO feature_flags (id, tenant_id, key, name, description, flag_type, default_value, status, environment)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `, [flagId, tenantId, parsed.key, parsed.name, parsed.description || null, parsed.flag_type, JSON.stringify(parsed.default_value), parsed.status, parsed.environment], tenantId);

  return res[0];
}

export async function evaluateFlag(tenantId: string, data: any) {
  const context = EvaluateContextSchema.parse(data);
  const flagKey = data.flag_key;

  const flagRes = await withTenantQuery(`
    SELECT * FROM feature_flags 
    WHERE (tenant_id = $1 OR tenant_id IS NULL) AND key = $2
    ORDER BY tenant_id DESC NULLS LAST LIMIT 1;
  `, [tenantId, flagKey], tenantId);

  const flag = flagRes[0];
  if (!flag) throw new AppError(`Feature flag key '${flagKey}' does not exist`, 'NOT_FOUND');

  const parsedDefault = typeof flag.default_value === 'string' ? JSON.parse(flag.default_value) : flag.default_value;

  if (flag.status === 'killed' || flag.status === 'archived') {
    return { value: parsedDefault, reason: 'flag_disabled' };
  }

  // 1. Check User Overrides
  const cleanUserId = context.userId ? parseUserId(context.userId) : null;
  if (cleanUserId) {
    const userOverride = await withTenantQuery(`
      SELECT value FROM flag_overrides WHERE flag_id = $1 AND override_type = 'user' AND target_id = $2;
    `, [flag.id, cleanUserId], tenantId);
    if (userOverride && userOverride.length > 0) {
      return { value: JSON.parse(userOverride[0].value), reason: 'user_override' };
    }
  }

  // 2. Check Targeting Rules (e.g. Percentage Rollout)
  const rules = await withTenantQuery(`
    SELECT * FROM flag_targeting_rules WHERE flag_id = $1 AND active = true ORDER BY priority DESC;
  `, [flag.id], tenantId);

  for (const rule of rules) {
    const config = typeof rule.rule_config === 'string' ? JSON.parse(rule.rule_config) : rule.rule_config;
    if (rule.rule_type === 'percentage_rollout') {
      const pct = config.rolloutPercentage || 0;
      if (evaluatePercentageRollout(flagKey, cleanUserId || tenantId, pct)) {
        return { value: JSON.parse(rule.return_value), reason: 'percentage_rollout_match' };
      }
    }
  }

  return { value: parsedDefault, reason: 'default_fallback' };
}
