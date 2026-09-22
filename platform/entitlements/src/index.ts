/**
 * @platform/entitlements
 *
 * Every generated feature-core spec (Schema Builder, Log Viewer, Env Manager,
 * Mock Data, CLI Tools, Plugin System, Event Bus, Webhook Tester, API Docs,
 * Rate Limiting) imports `getTierConfig(tenantId, featureName)` from a
 * `@platform/config` package that does not exist anywhere in this repo.
 *
 * `@platform/utils`'s `loadConfig(featureName, schema)` is the closest thing
 * that does exist — but it is global and static: the same tiers.* flags for
 * every tenant, no per-tenant override, no record of which tier a tenant is
 * actually on.
 *
 * This package is the real thing those specs assumed: it layers a tenant's
 * explicit per-tenant overrides (tenant_feature_overrides) on top of the
 * static default from @platform/utils, and returns the same shape those
 * specs already expect — so the 10 backlog cores can import getTierConfig
 * from here unchanged.
 *
 * Known limitation (v0.1, intentional): a tenant's assigned tier
 * (tenant_tiers) is tracked and settable via setTenantTier, but does not yet
 * change which flags are on by default — there is no tier->flags mapping
 * table yet. Only explicit overrides change behavior today. Wiring tier ->
 * default flags is the natural next increment once a real mapping exists.
 */

import { z, ZodSchema } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { loadConfig, AppError, ErrorCode, isValidUuid } from '@platform/utils';

export const SetTenantTierSchema = z.object({
  tier: z.enum(['standard', 'plus', 'enterprise']),
});

export const SetOverrideSchema = z.object({
  feature_name: z.string().min(1),
  override_key: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

interface TenantTierRow {
  tier: string;
}

interface OverrideRow {
  override_key: string;
  enabled: boolean;
}

/** Generic shape every backlog spec's config-schema.json already follows. */
export interface FeatureTierConfig {
  enabled: boolean;
  tiers: Record<string, boolean>;
  limits?: Record<string, number>;
}

const DEFAULT_TIER = 'standard';

const defaultFeatureConfigSchema = z
  .object({
    enabled: z.boolean(),
    tiers: z.record(z.boolean()),
    limits: z.record(z.number()).optional(),
  })
  .passthrough();

export async function getTenantTier(tenantId: string): Promise<string> {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }

  const rows = await withTenantQuery<TenantTierRow>(
    'SELECT tier FROM tenant_tiers WHERE tenant_id = $1',
    [tenantId],
    tenantId
  );

  return rows[0]?.tier ?? DEFAULT_TIER;
}

async function getOverrides(tenantId: string, featureName: string): Promise<OverrideRow[]> {
  return withTenantQuery<OverrideRow>(
    'SELECT override_key, enabled FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_name = $2',
    [tenantId, featureName],
    tenantId
  );
}

/**
 * Resolves the effective tier config for one tenant/feature pair:
 * global default (from config/<featureName>.json, via @platform/utils) with
 * per-tenant overrides applied on top.
 */
export async function getTierConfig<T extends FeatureTierConfig = FeatureTierConfig>(
  tenantId: string,
  featureName: string,
  schema?: ZodSchema<T>
): Promise<T> {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }

  const validationSchema = (schema ?? defaultFeatureConfigSchema) as ZodSchema<T>;
  const base = loadConfig<T>(featureName, validationSchema);
  const overrides = await getOverrides(tenantId, featureName);

  if (overrides.length === 0) {
    return base;
  }

  const merged: T = {
    ...base,
    tiers: { ...(base.tiers ?? {}) },
  };

  for (const override of overrides) {
    (merged.tiers as Record<string, boolean>)[override.override_key] = override.enabled;
  }

  return merged;
}

export async function setTenantTier(tenantId: string, data: unknown, updatedBy: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }

  const parsed = SetTenantTierSchema.parse(data);

  const res = await withTenantQuery(
    `INSERT INTO tenant_tiers (tenant_id, tier, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET tier = $2, updated_by = $3, updated_at = NOW()
     RETURNING *`,
    [tenantId, parsed.tier, updatedBy],
    tenantId
  );

  return res[0];
}

export async function setFeatureOverride(tenantId: string, data: unknown, updatedBy: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }

  const parsed = SetOverrideSchema.parse(data);

  const res = await withTenantQuery(
    `INSERT INTO tenant_feature_overrides (tenant_id, feature_name, override_key, enabled, reason, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, feature_name, override_key)
     DO UPDATE SET enabled = $4, reason = $5, updated_by = $6, updated_at = NOW()
     RETURNING *`,
    [tenantId, parsed.feature_name, parsed.override_key, parsed.enabled, parsed.reason ?? null, updatedBy],
    tenantId
  );

  return res[0];
}
