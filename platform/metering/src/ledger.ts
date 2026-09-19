/**
 * platform/metering/src/ledger.ts
 *
 * Real usage-ledger persistence for recordUsage().
 *
 * Writes to the `usage_events` table — that table already existed,
 * fully migrated (migrations/sql/V1__init.sql), indexed, and
 * RLS-hardened (migrations/sql/V2__rls_hardening.sql). Nothing ever
 * wrote to it: this function validated the event type, then only
 * logged a message. Every one of its 174+ call sites across the
 * platform (including crud-kernel, 269 dependents) believed usage
 * was being tracked for billing. It never was.
 *
 * Uses @platform/tenancy's withTenantQuery so this goes through the
 * same RLS-enforced, tenant-scoped connection pattern the rest of
 * the platform already uses (platform/files, platform/synthetic,
 * platform/ai-chat, etc.) — no new DB access pattern introduced.
 */
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getLogger } from '@platform/observability';
import { loadConfig, AppError, ErrorCode } from '@platform/utils';
import { withTenantQuery } from '@platform/tenancy';

const logger = getLogger('metering:ledger');

const MeteringConfigSchema = z.object({
  eventTypes: z.array(z.string()),
  defaultUnit: z.string(),
  billingEnabled: z.boolean()
});

export interface RecordUsageInput {
  tenantId: string;
  eventType: string;
  quantity: number;
  idempotencyKey: string;
  actorId?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  // 1. DYNAMIC LOAD: Read the "Product Catalog" from JSON
  const config = loadConfig('metering', MeteringConfigSchema);

  // 2. Business Rule: Reject events not in our manifest.
  // Deliberately non-throwing — this runs inside crud-kernel's
  // runCrudOperation() AFTER the real action and audit emit already
  // succeeded; throwing here would fail an otherwise-successful
  // request over a metering config mismatch. The rejection is still
  // loud (logger.error), just not fatal to the caller.
  if (!config.eventTypes.includes(input.eventType)) {
    logger.error({ eventType: input.eventType }, '❌ REJECTED: Usage event not in allowed manifest');
    return;
  }

  if (!config.billingEnabled) {
    logger.info({ tenantId: input.tenantId, type: input.eventType }, 'Billing disabled — usage event not persisted');
    return;
  }

  // 3. Malformed quantity IS a programmer error, not a config
  // mismatch — fail loudly rather than let it hit the DB's
  // `quantity > 0` CHECK constraint as an opaque Postgres error.
  if (!(input.quantity > 0)) {
    throw new AppError(`recordUsage quantity must be > 0 (got ${input.quantity})`, ErrorCode.BAD_REQUEST);
  }

  // 4. Real, idempotent, RLS-scoped ledger write.
  const rows = await withTenantQuery<{ id: string }>(
    `INSERT INTO usage_events
       (id, tenant_id, actor_id, event_type, quantity, unit, idempotency_key, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.tenantId,
      input.actorId ?? null,
      input.eventType,
      input.quantity,
      config.defaultUnit,
      input.idempotencyKey,
      input.resourceId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
    input.tenantId,
  );

  if (rows.length === 0) {
    logger.warn({ tenantId: input.tenantId, idempotencyKey: input.idempotencyKey }, 'Usage event already recorded — idempotent skip');
    return;
  }

  logger.info({
    tenantId: input.tenantId,
    type: input.eventType,
    qty: input.quantity
  }, '💰 Usage recorded for billing');
}
