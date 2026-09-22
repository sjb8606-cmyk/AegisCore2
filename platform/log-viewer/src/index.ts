/**
 * @platform/log-viewer
 *
 * Queryable application log index: ingest, filter, paginate, export.
 * Pure domain core. Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const IngestLogSchema = z.object({
  actor_id: z.string().uuid().optional().nullable(),
  actor_type: z.enum(['user', 'service', 'system']).default('user'),
  action: z.string().min(1).max(120),
  resource_type: z.string().max(80).optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
  outcome: z.enum(['success', 'failure', 'denied']).default('success'),
  message: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  ip_address: z.string().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
});

export const QueryLogsSchema = z.object({
  actor_id: z.string().uuid().optional(),
  action: z.string().optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  resource_type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  page_size: z.number().int().positive().max(100).default(25),
});

/** Export allows a larger page_size (capped by tier maxExportRows). */
export const ExportLogsSchema = QueryLogsSchema.extend({
  page_size: z.number().int().positive().max(10000).default(5000),
}).omit({ page: true });

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'log-viewer');
  if (!cfg.enabled) {
    throw new AppError('Log viewer is disabled', ErrorCode.FORBIDDEN);
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

export async function ingestLog(tenantId: string, input: unknown) {
  await requireEnabled(tenantId);
  const parsed = IngestLogSchema.parse(input);

  const rows = await withTenantQuery(
    `INSERT INTO app_log_events (
       tenant_id, actor_id, actor_type, action, resource_type, resource_id,
       outcome, message, metadata, ip_address, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::inet, COALESCE($11::timestamptz, NOW()))
     RETURNING *`,
    [
      tenantId,
      parsed.actor_id ?? null,
      parsed.actor_type,
      parsed.action,
      parsed.resource_type ?? null,
      parsed.resource_id ?? null,
      parsed.outcome,
      parsed.message ?? null,
      JSON.stringify(parsed.metadata ?? {}),
      parsed.ip_address ?? null,
      parsed.occurred_at ?? null,
    ],
    tenantId,
  );
  return rows[0];
}

export async function queryLogs(tenantId: string, input: unknown = {}) {
  const cfg = await requireTier(tenantId, 'queryLogs');
  const parsed = QueryLogsSchema.parse(input ?? {});

  if (parsed.actor_id) await requireTier(tenantId, 'filterByActor');
  if (parsed.action) await requireTier(tenantId, 'filterByAction');

  const maxPage = cfg.limits?.maxPageSize ?? 100;
  const pageSize = Math.min(parsed.page_size, maxPage);
  const offset = (parsed.page - 1) * pageSize;

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (parsed.actor_id) {
    conditions.push(`actor_id = \[ {idx++}`);
    params.push(parsed.actor_id);
  }
  if (parsed.action) {
    conditions.push(`action = \]{idx++}`);
    params.push(parsed.action);
  }
  if (parsed.outcome) {
    conditions.push(`outcome = \[ {idx++}`);
    params.push(parsed.outcome);
  }
  if (parsed.resource_type) {
    conditions.push(`resource_type = \]{idx++}`);
    params.push(parsed.resource_type);
  }
  if (parsed.from) {
    conditions.push(`occurred_at >= \[ {idx++}::timestamptz`);
    params.push(parsed.from);
  }
  if (parsed.to) {
    conditions.push(`occurred_at <= \]{idx++}::timestamptz`);
    params.push(parsed.to);
  }

  const where = conditions.join(' AND ');
  params.push(pageSize, offset);

  const rows = await withTenantQuery(
    `SELECT * FROM app_log_events
     WHERE ${where}
     ORDER BY occurred_at DESC
     LIMIT \[ {idx++} OFFSET \]{idx}`,
    params,
    tenantId,
  );

  const countParams = params.slice(0, params.length - 2);
  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS total FROM app_log_events WHERE ${where}`,
    countParams,
    tenantId,
  );

  return {
    items: rows,
    page: parsed.page,
    page_size: pageSize,
    total: countRows[0]?.total ?? 0,
  };
}

export async function exportLogs(tenantId: string, input: unknown = {}) {
  const cfg = await requireTier(tenantId, 'exportLogs');
  const maxExport = cfg.limits?.maxExportRows ?? 5000;

  const filters = ExportLogsSchema.parse({
    ...(typeof input === 'object' && input ? input : {}),
    page_size: maxExport,
  });

  // Reuse queryLogs with a single large page (page_size already validated for export)
  const result = await queryLogs(tenantId, {
    actor_id: filters.actor_id,
    action: filters.action,
    outcome: filters.outcome,
    resource_type: filters.resource_type,
    from: filters.from,
    to: filters.to,
    page: 1,
    page_size: Math.min(maxExport, 100), // queryLogs still caps at 100 per page
  });

  // For true multi-page export in v0.1 we return the first page up to maxPageSize.
  // Full multi-page export can be added later without breaking this API shape.
  return {
    items: result.items,
    exported_at: new Date().toISOString(),
    count: result.items.length,
  };
}
