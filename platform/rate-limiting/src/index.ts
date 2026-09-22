/**
 * @platform/rate-limiting
 *
 * Configurable rate-limit domain core.
 * - Tenant-scoped configs (scope: tenant | user | api_key | route)
 * - Allow / deny access lists
 * - Breach recording
 * - Pure fixed-window check helper (Redis middleware stays in @platform/security)
 *
 * Uses getTierConfig from @platform/entitlements so per-tenant overrides work.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

// ── Schemas ───────────────────────────────────────────────────

export const RateLimitConfigSchema = z.object({
  scope: z.enum(['tenant', 'user', 'api_key', 'route']),
  scope_key: z.string().min(1).optional().nullable(),
  algorithm: z.enum(['fixed_window', 'sliding_window', 'token_bucket']).default('fixed_window'),
  requests: z.number().int().positive(),
  window_seconds: z.number().int().positive(),
  burst_limit: z.number().int().positive().optional().nullable(),
  active: z.boolean().default(true),
});

export type RateLimitConfigInput = z.infer<typeof RateLimitConfigSchema>;

export const AccessListEntrySchema = z.object({
  list_type: z.enum(['allow', 'deny']),
  match_type: z.enum(['ip', 'cidr', 'user_id', 'api_key']),
  match_value: z.string().min(1),
  reason: z.string().optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export type AccessListEntryInput = z.infer<typeof AccessListEntrySchema>;

export const CheckLimitSchema = z.object({
  scope: z.enum(['tenant', 'user', 'api_key', 'route']),
  scope_key: z.string().optional().nullable(),
  /** Current request count in the window (caller supplies from Redis or store). */
  current_count: z.number().int().nonnegative(),
  route: z.string().optional(),
  actor_id: z.string().uuid().optional(),
  actor_ip: z.string().optional(),
});

// ── Tier gate ─────────────────────────────────────────────────

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'rate-limiting');
  if (!cfg.enabled) {
    throw new AppError('Rate limiting is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

// ── Config CRUD ───────────────────────────────────────────────

export async function createOrUpdateConfig(
  tenantId: string,
  input: unknown,
) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.perTenantConfig) {
    throw new AppError('Per-tenant rate limit config not available in current tier', ErrorCode.FORBIDDEN);
  }

  const parsed = RateLimitConfigSchema.parse(input);
  const max = cfg.limits?.maxConfiguredLimitsPerTenant ?? 500;

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM rate_limit_configs WHERE tenant_id = $1 AND active = true`,
    [tenantId],
    tenantId,
  );
  // Allow upsert of existing key without counting against quota
  const existing = await withTenantQuery(
    `SELECT id FROM rate_limit_configs WHERE tenant_id = $1 AND scope = $2 AND COALESCE(scope_key, '') = COALESCE($3, '')`,
    [tenantId, parsed.scope, parsed.scope_key ?? null],
    tenantId,
  );
  if (!existing.length && (countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Max configured limits (${max}) reached for tenant`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `
    INSERT INTO rate_limit_configs (
      tenant_id, scope, scope_key, algorithm, requests, window_seconds, burst_limit, active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (tenant_id, scope, scope_key) DO UPDATE SET
      algorithm = EXCLUDED.algorithm,
      requests = EXCLUDED.requests,
      window_seconds = EXCLUDED.window_seconds,
      burst_limit = EXCLUDED.burst_limit,
      active = EXCLUDED.active,
      updated_at = NOW()
    RETURNING *
    `,
    [
      tenantId,
      parsed.scope,
      parsed.scope_key ?? null,
      parsed.algorithm,
      parsed.requests,
      parsed.window_seconds,
      parsed.burst_limit ?? null,
      parsed.active,
    ],
    tenantId,
  );

  return rows[0];
}

export async function listConfigs(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM rate_limit_configs WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
    tenantId,
  );
}

export async function resolveConfig(
  tenantId: string,
  scope: string,
  scopeKey?: string | null,
) {
  await requireEnabled(tenantId);

  // Hierarchical: exact scope+key → tenant default → static default
  const exact = await withTenantQuery(
    `SELECT * FROM rate_limit_configs
     WHERE tenant_id = $1 AND scope = $2 AND COALESCE(scope_key, '') = COALESCE($3, '') AND active = true
     LIMIT 1`,
    [tenantId, scope, scopeKey ?? null],
    tenantId,
  );
  if (exact.length) return exact[0];

  if (scope !== 'tenant') {
    const tenantDefault = await withTenantQuery(
      `SELECT * FROM rate_limit_configs
       WHERE tenant_id = $1 AND scope = 'tenant' AND scope_key IS NULL AND active = true
       LIMIT 1`,
      [tenantId],
      tenantId,
    );
    if (tenantDefault.length) return tenantDefault[0];
  }

  const cfg = await getTierConfig(tenantId, 'rate-limiting');
  return {
    scope: 'tenant',
    scope_key: null,
    algorithm: 'fixed_window',
    requests: cfg.limits?.defaultRequestsPerMinute ?? 1000,
    window_seconds: 60,
    burst_limit: null,
    active: true,
    _source: 'default',
  };
}

// ── Access list ───────────────────────────────────────────────

export async function addAccessListEntry(tenantId: string, input: unknown) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.allowDenyList) {
    throw new AppError('Allow/deny lists not available in current tier', ErrorCode.FORBIDDEN);
  }

  const parsed = AccessListEntrySchema.parse(input);

  const rows = await withTenantQuery(
    `
    INSERT INTO rate_limit_access_list (
      tenant_id, list_type, match_type, match_value, reason, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, list_type, match_type, match_value) DO UPDATE SET
      reason = EXCLUDED.reason,
      expires_at = EXCLUDED.expires_at
    RETURNING *
    `,
    [
      tenantId,
      parsed.list_type,
      parsed.match_type,
      parsed.match_value,
      parsed.reason ?? null,
      parsed.expires_at ?? null,
    ],
    tenantId,
  );

  return rows[0];
}

/**
 * Returns:
 *  - 'deny'  → hard block
 *  - 'allow' → bypass rate limit
 *  - 'none'  → apply normal limits
 */
export async function evaluateAccessList(
  tenantId: string,
  matchType: 'ip' | 'cidr' | 'user_id' | 'api_key',
  matchValue: string,
): Promise<'deny' | 'allow' | 'none'> {
  await requireEnabled(tenantId);

  const rows = await withTenantQuery(
    `
    SELECT list_type FROM rate_limit_access_list
    WHERE tenant_id = $1
      AND match_type = $2
      AND match_value = $3
      AND (expires_at IS NULL OR expires_at > NOW())
    `,
    [tenantId, matchType, matchValue],
    tenantId,
  );

  if (rows.some((r: any) => r.list_type === 'deny')) return 'deny';
  if (rows.some((r: any) => r.list_type === 'allow')) return 'allow';
  return 'none';
}

// ── Check + breach ────────────────────────────────────────────

export interface CheckLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  window_seconds: number;
  reason?: string;
}

/**
 * Pure decision helper. Caller supplies current_count from Redis (or test double).
 * Does not talk to Redis itself — keeps the core free of infra coupling.
 */
export async function checkLimit(
  tenantId: string,
  input: unknown,
): Promise<CheckLimitResult> {
  const parsed = CheckLimitSchema.parse(input);
  await requireEnabled(tenantId);

  // Access list short-circuit
  if (parsed.actor_ip) {
    const decision = await evaluateAccessList(tenantId, 'ip', parsed.actor_ip);
    if (decision === 'deny') {
      return { allowed: false, remaining: 0, limit: 0, window_seconds: 0, reason: 'deny_list' };
    }
    if (decision === 'allow') {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, limit: 0, window_seconds: 0, reason: 'allow_list' };
    }
  }
  if (parsed.actor_id) {
    const decision = await evaluateAccessList(tenantId, 'user_id', parsed.actor_id);
    if (decision === 'deny') {
      return { allowed: false, remaining: 0, limit: 0, window_seconds: 0, reason: 'deny_list' };
    }
    if (decision === 'allow') {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, limit: 0, window_seconds: 0, reason: 'allow_list' };
    }
  }

  const config = await resolveConfig(tenantId, parsed.scope, parsed.scope_key);
  const limit = Number(config.requests);
  const windowSeconds = Number(config.window_seconds);
  const remaining = Math.max(0, limit - parsed.current_count);
  const allowed = parsed.current_count <= limit;

  if (!allowed) {
    await recordBreach(tenantId, {
      scope: parsed.scope,
      scope_key: parsed.scope_key,
      actor_id: parsed.actor_id,
      actor_ip: parsed.actor_ip,
      route: parsed.route,
      limit_value: limit,
      request_count: parsed.current_count,
      window_seconds: windowSeconds,
    });
  }

  return { allowed, remaining, limit, window_seconds: windowSeconds };
}

export async function recordBreach(tenantId: string, data: {
  scope: string;
  scope_key?: string | null;
  actor_id?: string;
  actor_ip?: string;
  route?: string;
  limit_value: number;
  request_count: number;
  window_seconds: number;
}) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }

  const rows = await withTenantQuery(
    `
    INSERT INTO rate_limit_breaches (
      tenant_id, scope, scope_key, actor_id, actor_ip, route,
      limit_value, request_count, window_seconds
    ) VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8, $9)
    RETURNING *
    `,
    [
      tenantId,
      data.scope,
      data.scope_key ?? null,
      data.actor_id ?? null,
      data.actor_ip ?? null,
      data.route ?? null,
      data.limit_value,
      data.request_count,
      data.window_seconds,
    ],
    tenantId,
  );

  return rows[0];
}
