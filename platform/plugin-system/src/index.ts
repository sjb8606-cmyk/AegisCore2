/**
 * @platform/plugin-system
 *
 * Register plugins, enable/disable, store config, register hooks.
 * Hook dispatch is ordered by priority; handlers are invoked via an
 * injected dispatcher so the core stays pure.
 * Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const RegisterPluginSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(40).default('0.1.0'),
  description: z.string().max(2000).optional().nullable(),
  config: z.record(z.unknown()).optional().nullable(),
});

export const RegisterHookSchema = z.object({
  event_name: z.string().min(1).max(120),
  handler_key: z.string().min(1).max(120),
  priority: z.number().int().default(100),
});

export type HookDispatcher = (
  handlerKey: string,
  eventName: string,
  payload: unknown,
  ctx: { tenantId: string; pluginId: string },
) => Promise<unknown>;

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'plugin-system');
  if (!cfg.enabled) {
    throw new AppError('Plugin system is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

async function requireTier(tenantId: string, feature: string) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.[feature]) {
    throw new AppError(`Feature ${feature} not available in current tier`, ErrorCode.FORBIDDEN);
  }
  return cfg;
}

export async function registerPlugin(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'registerPlugins');
  const parsed = RegisterPluginSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM plugins WHERE tenant_id = $1 AND status <> 'disabled'`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.maxPluginsPerTenant ?? 50;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Plugin limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO plugins (tenant_id, key, name, version, description, config, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (tenant_id, key) DO UPDATE SET
       name = EXCLUDED.name,
       version = EXCLUDED.version,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      parsed.key,
      parsed.name,
      parsed.version,
      parsed.description ?? null,
      JSON.stringify(parsed.config ?? {}),
      createdBy,
    ],
    tenantId,
  );
  return rows[0];
}

export async function listPlugins(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM plugins WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
    tenantId,
  );
}

export async function getPlugin(tenantId: string, pluginId: string) {
  await requireEnabled(tenantId);
  if (!isValidUuid(pluginId)) {
    throw new AppError('Invalid plugin id', ErrorCode.BAD_REQUEST);
  }
  const rows = await withTenantQuery(
    `SELECT * FROM plugins WHERE id = $1 AND tenant_id = $2`,
    [pluginId, tenantId],
    tenantId,
  );
  if (!rows.length) throw new AppError('Plugin not found', ErrorCode.NOT_FOUND);
  return rows[0];
}

export async function setPluginStatus(
  tenantId: string,
  pluginId: string,
  status: 'enabled' | 'disabled',
) {
  await requireTier(tenantId, 'enablePlugins');
  await getPlugin(tenantId, pluginId);
  const rows = await withTenantQuery(
    `UPDATE plugins SET status = $3, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [pluginId, tenantId, status],
    tenantId,
  );
  return rows[0];
}

export async function updatePluginConfig(
  tenantId: string,
  pluginId: string,
  config: Record<string, unknown>,
) {
  await requireTier(tenantId, 'pluginConfig');
  await getPlugin(tenantId, pluginId);
  const rows = await withTenantQuery(
    `UPDATE plugins SET config = $3::jsonb, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [pluginId, tenantId, JSON.stringify(config)],
    tenantId,
  );
  return rows[0];
}

export async function registerHook(tenantId: string, pluginId: string, input: unknown) {
  const cfg = await requireTier(tenantId, 'hooks');
  const parsed = RegisterHookSchema.parse(input);
  await getPlugin(tenantId, pluginId);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM plugin_hooks WHERE plugin_id = $1 AND active = true`,
    [pluginId],
    tenantId,
  );
  const max = cfg.limits?.maxHooksPerPlugin ?? 20;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Hook limit (${max}) reached for plugin`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO plugin_hooks (tenant_id, plugin_id, event_name, handler_key, priority)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (plugin_id, event_name, handler_key) DO UPDATE SET
       priority = EXCLUDED.priority,
       active = true
     RETURNING *`,
    [tenantId, pluginId, parsed.event_name, parsed.handler_key, parsed.priority],
    tenantId,
  );
  return rows[0];
}

/**
 * Dispatch an event to all active hooks for enabled plugins, ordered by priority ASC.
 */
export async function dispatchEvent(
  tenantId: string,
  eventName: string,
  payload: unknown,
  dispatcher: HookDispatcher,
) {
  await requireTier(tenantId, 'hooks');

  const hooks = await withTenantQuery(
    `SELECT h.*, p.id AS plugin_id
     FROM plugin_hooks h
     JOIN plugins p ON p.id = h.plugin_id
     WHERE h.tenant_id = $1
       AND h.event_name = $2
       AND h.active = true
       AND p.status = 'enabled'
     ORDER BY h.priority ASC`,
    [tenantId, eventName],
    tenantId,
  );

  const results: unknown[] = [];
  for (const hook of hooks) {
    const out = await dispatcher(hook.handler_key, eventName, payload, {
      tenantId,
      pluginId: hook.plugin_id,
    });
    results.push(out);
  }
  return results;
}
