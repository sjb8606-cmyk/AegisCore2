/**
 * platform/aegis-swarm/src/lib/restraint-store.ts
 *
 * Real, tenant-scoped (RLS-protected) storage for D-22's Proof-of-
 * Restraint ledger. Deliberately provides only recordRefusal() and
 * listRefusals() — no update or delete function exists at all,
 * matching "records every declined action immutably" in this bot's
 * own name and role. There is no way to alter or remove a recorded
 * refusal through this module.
 *
 * Table: migrations/sql/V269__create_proof_of_restraint.sql
 */

import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';

export interface RestraintRecord {
  id: string;
  tenantId: string;
  botId: string;
  actionBlocked: string;
  refusalReason: string;
  inputContext: Record<string, unknown>;
  receiptId: string | null;
  createdAt: string;
}

function mapRow(row: any): RestraintRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    botId: row.bot_id,
    actionBlocked: row.action_blocked,
    refusalReason: row.refusal_reason,
    inputContext: row.input_context ?? {},
    receiptId: row.receipt_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function recordRefusal(
  tenantId: string,
  botId: string,
  actionBlocked: string,
  refusalReason: string,
  inputContext: Record<string, unknown> = {},
): Promise<RestraintRecord> {
  const id = randomUUID();

  const rows = await withTenantQuery(
    `INSERT INTO proof_of_restraint (id, tenant_id, bot_id, action_blocked, refusal_reason, input_context)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, tenant_id, bot_id, action_blocked, refusal_reason, input_context, receipt_id, created_at`,
    [id, tenantId, botId, actionBlocked, refusalReason, JSON.stringify(inputContext)],
    tenantId,
  );

  return mapRow(rows[0]);
}

export async function listRefusals(tenantId: string, limit = 50): Promise<RestraintRecord[]> {
  const rows = await withTenantQuery(
    `SELECT id, tenant_id, bot_id, action_blocked, refusal_reason, input_context, receipt_id, created_at
     FROM proof_of_restraint
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
    tenantId,
  );

  return rows.map(mapRow);
}
