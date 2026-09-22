/**
 * @platform/event-bus
 *
 * In-process event bus with persisted log, subscriptions, and DLQ.
 * Handlers invoked via injected dispatcher. Tier-gated via entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const SubscribeSchema = z.object({
  topic: z.string().min(1).max(120),
  handler_key: z.string().min(1).max(120),
});

export const PublishSchema = z.object({
  topic: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
});

export type EventDispatcher = (
  handlerKey: string,
  topic: string,
  payload: unknown,
  ctx: { tenantId: string; eventId: string },
) => Promise<void>;

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'event-bus');
  if (!cfg.enabled) {
    throw new AppError('Event bus is disabled', ErrorCode.FORBIDDEN);
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

export async function subscribe(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'subscribe');
  const parsed = SubscribeSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM event_subscriptions WHERE tenant_id = $1 AND active = true`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.maxSubscriptionsPerTenant ?? 100;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Subscription limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO event_subscriptions (tenant_id, topic, handler_key, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, topic, handler_key) DO UPDATE SET active = true
     RETURNING *`,
    [tenantId, parsed.topic, parsed.handler_key, createdBy],
    tenantId,
  );
  return rows[0];
}

export async function listSubscriptions(tenantId: string, topic?: string) {
  await requireEnabled(tenantId);
  if (topic) {
    return withTenantQuery(
      `SELECT * FROM event_subscriptions WHERE tenant_id = $1 AND topic = $2 AND active = true`,
      [tenantId, topic],
      tenantId,
    );
  }
  return withTenantQuery(
    `SELECT * FROM event_subscriptions WHERE tenant_id = $1 AND active = true ORDER BY topic`,
    [tenantId],
    tenantId,
  );
}

export async function publish(
  tenantId: string,
  input: unknown,
  publishedBy: string,
  dispatcher: EventDispatcher,
) {
  await requireTier(tenantId, 'publish');
  const parsed = PublishSchema.parse(input);

  const payloadStr = JSON.stringify(parsed.payload);
  const maxBytes = (await getTierConfig(tenantId, 'event-bus')).limits?.maxPayloadBytes ?? 65536;
  if (Buffer.byteLength(payloadStr, 'utf8') > maxBytes) {
    throw new AppError(`Payload exceeds max size (${maxBytes} bytes)`, ErrorCode.BAD_REQUEST);
  }

  const logRows = await withTenantQuery(
    `INSERT INTO event_log (tenant_id, topic, payload, published_by)
     VALUES ($1,$2,$3::jsonb,$4)
     RETURNING *`,
    [tenantId, parsed.topic, payloadStr, publishedBy],
    tenantId,
  );
  const event = logRows[0];

  const subs = await withTenantQuery(
    `SELECT * FROM event_subscriptions WHERE tenant_id = $1 AND topic = $2 AND active = true`,
    [tenantId, parsed.topic],
    tenantId,
  );

  const failures: { handler_key: string; error: string }[] = [];
  for (const sub of subs) {
    try {
      await dispatcher(sub.handler_key, parsed.topic, parsed.payload, {
        tenantId,
        eventId: event.id,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ handler_key: sub.handler_key, error: msg });
      await requireTier(tenantId, 'deadLetter').catch(() => null);
      await withTenantQuery(
        `INSERT INTO event_dead_letters (tenant_id, event_id, topic, handler_key, payload, error_message)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [tenantId, event.id, parsed.topic, sub.handler_key, payloadStr, msg],
        tenantId,
      ).catch(() => null);
    }
  }

  return { event, delivered: subs.length - failures.length, failures };
}

export async function listEvents(tenantId: string, topic?: string, limit = 50) {
  await requireTier(tenantId, 'replay');
  const safeLimit = Math.min(Math.max(1, limit), 200);
  if (topic) {
    return withTenantQuery(
      `SELECT * FROM event_log WHERE tenant_id = $1 AND topic = $2 ORDER BY published_at DESC LIMIT $3`,
      [tenantId, topic, safeLimit],
      tenantId,
    );
  }
  return withTenantQuery(
    `SELECT * FROM event_log WHERE tenant_id = $1 ORDER BY published_at DESC LIMIT $2`,
    [tenantId, safeLimit],
    tenantId,
  );
}

export async function listDeadLetters(tenantId: string, limit = 50) {
  await requireTier(tenantId, 'deadLetter');
  const safeLimit = Math.min(Math.max(1, limit), 200);
  return withTenantQuery(
    `SELECT * FROM event_dead_letters WHERE tenant_id = $1 ORDER BY failed_at DESC LIMIT $2`,
    [tenantId, safeLimit],
    tenantId,
  );
}
