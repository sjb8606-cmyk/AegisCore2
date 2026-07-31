/**
 * Veridact v1.0 — Change Log Engine
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';
import { logger } from '../db/logger';
import { withTenant } from '../db/client';
import type { Actor, ChangeEntry, Diff } from '../types';
import { ChangeEntrySchema } from '../schemas';

export function hashState(state: Record<string, unknown>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)))
  );
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Diff {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff: Diff = [];

  for (const field of allKeys) {
    const beforeVal = before[field];
    const afterVal = after[field];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diff.push({ field, before: beforeVal, after: afterVal });
    }
  }

  return diff;
}

type ChangeEventType = 'rule_change' | 'manual_override' | 'system_update';
type InternalTrigger = ChangeEventType | 'new_receipt';

interface WriteChangeParams {
  tenantId: string;
  eventType: InternalTrigger;
  actor: Actor;
  actionType: string;
  previousStateHash: string;
  newStateHash: string;
  diff: Diff;
  linkedReceipt?: string;
  client: PoolClient;
}

export async function writeChangeEntry(params: WriteChangeParams): Promise<ChangeEntry> {
  const {
    tenantId,
    eventType,
    actor,
    actionType,
    previousStateHash,
    newStateHash,
    diff,
    linkedReceipt,
    client,
  } = params;

  const changeEventType: ChangeEventType =
    eventType === 'new_receipt' ? 'system_update' : eventType;

  const changeId = uuidv4();
  const now = new Date().toISOString();

  const entry: ChangeEntry = {
    change_id: changeId,
    tenant_id: tenantId,
    event_type: changeEventType,
    timestamp: now,
    actor,
    action_type: actionType,
    previous_state_hash: previousStateHash,
    new_state_hash: newStateHash,
    diff,
    linked_receipt: linkedReceipt,
  };

  const parsed = ChangeEntrySchema.safeParse(entry);
  if (!parsed.success) {
    logger.error({ errors: parsed.error.errors }, 'change.schema_validation_failed');
    throw new Error(`ChangeEntry schema validation failed: ${parsed.error.message}`);
  }

  await client.query(
    `INSERT INTO changes (
      change_id, tenant_id, event_type, actor, action_type,
      previous_state_hash, new_state_hash, diff, linked_receipt, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      changeId,
      tenantId,
      changeEventType,
      JSON.stringify(actor),
      actionType,
      previousStateHash,
      newStateHash,
      JSON.stringify(diff),
      linkedReceipt ?? null,
    ]
  );

  logger.info(
    {
      change_id: changeId,
      event_type: changeEventType,
      tenant_id: tenantId,
      action_type: actionType,
      diff_fields: diff.map((d) => d.field),
    },
    'change.written'
  );

  return entry;
}

export interface ListChangesParams {
  tenantId: string;
  page: number;
  limit: number;
  actorId?: string;
  eventType?: ChangeEventType;
  from?: string;
  to?: string;
}

export interface ChangeRow {
  change_id: string;
  tenant_id: string;
  event_type: string;
  actor: Actor;
  action_type: string;
  previous_state_hash: string;
  new_state_hash: string;
  diff: Diff;
  linked_receipt?: string;
  created_at: Date;
}

function rowToChangeEntry(row: ChangeRow): ChangeEntry {
  return {
    change_id: row.change_id,
    tenant_id: row.tenant_id,
    event_type: row.event_type as ChangeEntry['event_type'],
    timestamp: row.created_at.toISOString(),
    actor: row.actor,
    action_type: row.action_type,
    previous_state_hash: row.previous_state_hash,
    new_state_hash: row.new_state_hash,
    diff: Array.isArray(row.diff) ? row.diff : [],
    linked_receipt: row.linked_receipt,
  };
}

export async function listChanges(
  params: ListChangesParams
): Promise<{ rows: ChangeEntry[]; total: number }> {
  const { tenantId, page, limit, actorId, eventType, from, to } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
  const values: unknown[] = [tenantId];
  let paramIndex = 2;

  if (actorId) {
    conditions.push(`actor->>'id' = $${paramIndex++}`);
    values.push(actorId);
  }
  if (eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(eventType);
  }
  if (from) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(to);
  }

  const where = conditions.join(' AND ');

  return withTenant(tenantId, async (client) => {
    const [dataRes, countRes] = await Promise.all([
      client.query<ChangeRow>(
        `SELECT * FROM changes WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset]
      ),
      client.query<{ count: string }>(`SELECT COUNT(*) as count FROM changes WHERE ${where}`, values),
    ]);

    return {
      rows: dataRes.rows.map(rowToChangeEntry),
      total: parseInt(countRes.rows[0].count, 10),
    };
  });
}
