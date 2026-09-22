/**
 * @platform/env-manager
 *
 * Per-tenant environment lifecycle: register environments, manage variables
 * (including secret flag), request/approve promotions.
 *
 * Pure domain core. No Express. Tier-gated via @platform/entitlements.
 * Secret values are stored as provided; wire @platform/security KMS at the
 * route/adapter layer when encrypt-at-rest is required.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

// ── Schemas ───────────────────────────────────────────────────

export const CreateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['development', 'staging', 'production', 'custom']),
});

export const SetVariableSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string(),
  is_secret: z.boolean().default(false),
});

export const PromotionRequestSchema = z.object({
  source_env_id: z.string().uuid(),
  target_env_id: z.string().uuid(),
});

// ── Tier helpers ──────────────────────────────────────────────

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'env-manager');
  if (!cfg.enabled) {
    throw new AppError('Env manager is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

async function requireTier(tenantId: string, feature: string) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.[feature]) {
    throw new AppError(
      `Feature ${feature} not available in current tier`,
      ErrorCode.FORBIDDEN,
    );
  }
  return cfg;
}

async function logActivity(
  tenantId: string,
  environmentId: string,
  action: string,
  actorId: string | null,
  detail: Record<string, unknown> = {},
) {
  await withTenantQuery(
    `INSERT INTO environment_activity_log (tenant_id, environment_id, action, actor_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, environmentId, action, actorId, JSON.stringify(detail)],
    tenantId,
  );
}

// ── Environments ──────────────────────────────────────────────

export async function createEnvironment(
  tenantId: string,
  input: unknown,
  createdBy: string,
) {
  const cfg = await requireTier(tenantId, 'environmentRegistration');
  const parsed = CreateEnvironmentSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM environments WHERE tenant_id = $1 AND status <> 'torn_down'`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.environmentsPerTenant ?? 20;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(
      `Environment limit (${max}) reached for tenant`,
      ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED',
    );
  }

  const isProduction = parsed.type === 'production';
  const rows = await withTenantQuery(
    `INSERT INTO environments (tenant_id, name, type, is_production, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, parsed.name, parsed.type, isProduction, createdBy],
    tenantId,
  );

  const env = rows[0];
  await logActivity(tenantId, env.id, 'environment.created', createdBy, {
    name: parsed.name,
    type: parsed.type,
  });
  return env;
}

export async function listEnvironments(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM environments WHERE tenant_id = $1 AND status <> 'torn_down' ORDER BY created_at`,
    [tenantId],
    tenantId,
  );
}

export async function getEnvironment(tenantId: string, environmentId: string) {
  await requireEnabled(tenantId);
  if (!isValidUuid(environmentId)) {
    throw new AppError('Invalid environment id', ErrorCode.BAD_REQUEST);
  }
  const rows = await withTenantQuery(
    `SELECT * FROM environments WHERE id = $1 AND tenant_id = $2`,
    [environmentId, tenantId],
    tenantId,
  );
  if (!rows.length) {
    throw new AppError('Environment not found', ErrorCode.NOT_FOUND);
  }
  return rows[0];
}

// ── Variables ─────────────────────────────────────────────────

export async function setVariable(
  tenantId: string,
  environmentId: string,
  input: unknown,
  updatedBy: string,
) {
  const cfg = await requireTier(tenantId, 'variableManagement');
  const parsed = SetVariableSchema.parse(input);

  if (parsed.is_secret) {
    await requireTier(tenantId, 'secretManagement');
  }

  // Ensure environment exists
  await getEnvironment(tenantId, environmentId);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM environment_variables WHERE environment_id = $1`,
    [environmentId],
    tenantId,
  );
  const existing = await withTenantQuery(
    `SELECT id FROM environment_variables WHERE environment_id = $1 AND key = $2`,
    [environmentId, parsed.key],
    tenantId,
  );
  const maxVars = cfg.limits?.variablesPerEnvironment ?? 200;
  if (!existing.length && (countRows[0]?.cnt ?? 0) >= maxVars) {
    throw new AppError(
      `Variable limit (${maxVars}) reached for environment`,
      ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED',
    );
  }

  const rows = await withTenantQuery(
    `INSERT INTO environment_variables (tenant_id, environment_id, key, value, is_secret, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (environment_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       is_secret = EXCLUDED.is_secret,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING id, tenant_id, environment_id, key, is_secret, updated_by, updated_at, created_at,
               CASE WHEN is_secret THEN NULL ELSE value END AS value`,
    [tenantId, environmentId, parsed.key, parsed.value, parsed.is_secret, updatedBy],
    tenantId,
  );

  await logActivity(tenantId, environmentId, 'variable.set', updatedBy, {
    key: parsed.key,
    is_secret: parsed.is_secret,
  });

  return rows[0];
}

/**
 * List variables. Secrets have value redacted (null) unless revealSecrets=true.
 */
export async function listVariables(
  tenantId: string,
  environmentId: string,
  revealSecrets = false,
) {
  await requireEnabled(tenantId);
  await getEnvironment(tenantId, environmentId);

  const rows = await withTenantQuery(
    `SELECT id, tenant_id, environment_id, key, is_secret, updated_by, updated_at, created_at,
            CASE WHEN is_secret AND NOT $3 THEN NULL ELSE value END AS value
     FROM environment_variables
     WHERE environment_id = $1 AND tenant_id = $2
     ORDER BY key`,
    [environmentId, tenantId, revealSecrets],
    tenantId,
  );
  return rows;
}

// ── Promotions ────────────────────────────────────────────────

export async function requestPromotion(
  tenantId: string,
  input: unknown,
  requestedBy: string,
) {
  await requireTier(tenantId, 'promotionPipeline');
  const parsed = PromotionRequestSchema.parse(input);

  if (parsed.source_env_id === parsed.target_env_id) {
    throw new AppError('Source and target environment must differ', ErrorCode.BAD_REQUEST);
  }

  // Both envs must exist
  await getEnvironment(tenantId, parsed.source_env_id);
  await getEnvironment(tenantId, parsed.target_env_id);

  const rows = await withTenantQuery(
    `INSERT INTO environment_promotions (
       tenant_id, source_env_id, target_env_id, requested_by, approval_expires_at
     ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '72 hours')
     RETURNING *`,
    [tenantId, parsed.source_env_id, parsed.target_env_id, requestedBy],
    tenantId,
  );

  const promo = rows[0];
  await logActivity(tenantId, parsed.source_env_id, 'promotion.requested', requestedBy, {
    promotion_id: promo.id,
    target_env_id: parsed.target_env_id,
  });
  return promo;
}

export async function approvePromotion(
  tenantId: string,
  promotionId: string,
  approvedBy: string,
) {
  await requireTier(tenantId, 'promotionGates');
  if (!isValidUuid(promotionId)) {
    throw new AppError('Invalid promotion id', ErrorCode.BAD_REQUEST);
  }

  const existing = await withTenantQuery(
    `SELECT * FROM environment_promotions WHERE id = $1 AND tenant_id = $2`,
    [promotionId, tenantId],
    tenantId,
  );
  if (!existing.length) {
    throw new AppError('Promotion not found', ErrorCode.NOT_FOUND);
  }
  if (existing[0].status !== 'pending_approval') {
    throw new AppError(
      `Promotion is ${existing[0].status}, cannot approve`,
      ErrorCode.BAD_REQUEST,
    );
  }

  // Copy non-secret + secret variables from source → target (upsert)
  await withTenantQuery(
    `INSERT INTO environment_variables (tenant_id, environment_id, key, value, is_secret, updated_by, updated_at)
     SELECT $1, ep.target_env_id, ev.key, ev.value, ev.is_secret, $3, NOW()
     FROM environment_promotions ep
     JOIN environment_variables ev ON ev.environment_id = ep.source_env_id
     WHERE ep.id = $2 AND ep.tenant_id = $1
     ON CONFLICT (environment_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       is_secret = EXCLUDED.is_secret,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [tenantId, promotionId, approvedBy],
    tenantId,
  );

  const rows = await withTenantQuery(
    `UPDATE environment_promotions
     SET status = 'completed', approved_by = $3, promoted_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [promotionId, tenantId, approvedBy],
    tenantId,
  );

  const promo = rows[0];
  await logActivity(tenantId, promo.source_env_id, 'promotion.completed', approvedBy, {
    promotion_id: promotionId,
    target_env_id: promo.target_env_id,
  });
  return promo;
}
