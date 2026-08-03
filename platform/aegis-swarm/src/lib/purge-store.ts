/**
 * platform/aegis-swarm/src/lib/purge-store.ts
 *
 * Real, tenant-scoped (RLS-protected) storage for D-12's 24-hour
 * purge time-lock. Unlike bot_decisions (system-level swarm
 * bookkeeping, no RLS), this table holds genuine customer data
 * deletion requests — real tenant data, real RLS.
 *
 * Both guarded transitions (cancel, execute) are enforced at the SQL
 * level via the WHERE clause, not just in application code — the same
 * principle as bot-runtime's updateDecisionStatus(). RETURNING id
 * tells the caller whether the guard actually matched a row, since
 * withTenantQuery() only returns rows, not a rowCount.
 *
 * receipt_id is a nullable placeholder — @features/veridact has not
 * been built in this repo, so there is no real cryptographic receipt
 * to attach yet.
 *
 * Table: migrations/sql/V267__create_pending_purges.sql
 */

import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';

export type PurgeStatus = 'pending' | 'executed' | 'cancelled';

export interface PendingPurge {
  id: string;
  tenantId: string;
  dataScope: string;
  authorizedBy: string;
  unlocksAt: string;
  status: PurgeStatus;
  receiptId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;

function mapRow(row: any): PendingPurge {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    dataScope: row.data_scope,
    authorizedBy: row.authorized_by,
    unlocksAt: new Date(row.unlocks_at).toISOString(),
    status: row.status,
    receiptId: row.receipt_id,
    createdAt: new Date(row.created_at).toISOString(),
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
  };
}

export async function requestPurge(
  tenantId: string,
  dataScope: string,
  authorizedBy: string,
): Promise<PendingPurge> {
  const id = randomUUID();
  const unlocksAt = new Date(Date.now() + LOCK_DURATION_MS);

  const rows = await withTenantQuery(
    `INSERT INTO pending_purges (id, tenant_id, data_scope, authorized_by, unlocks_at, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id, tenant_id, data_scope, authorized_by, unlocks_at, status, receipt_id, created_at, decided_at`,
    [id, tenantId, dataScope, authorizedBy, unlocksAt],
    tenantId,
  );

  return mapRow(rows[0]);
}

export async function getPurge(tenantId: string, purgeId: string): Promise<PendingPurge | null> {
  const rows = await withTenantQuery(
    `SELECT id, tenant_id, data_scope, authorized_by, unlocks_at, status, receipt_id, created_at, decided_at
     FROM pending_purges
     WHERE id = $1`,
    [purgeId],
    tenantId,
  );

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function cancelPurge(tenantId: string, purgeId: string): Promise<boolean> {
  const rows = await withTenantQuery(
    `UPDATE pending_purges
     SET status = 'cancelled', decided_at = NOW()
     WHERE id = $1 AND status = 'pending' AND unlocks_at > NOW()
     RETURNING id`,
    [purgeId],
    tenantId,
  );

  return rows.length > 0;
}

export async function executePurge(tenantId: string, purgeId: string): Promise<boolean> {
  const rows = await withTenantQuery(
    `UPDATE pending_purges
     SET status = 'executed', decided_at = NOW()
     WHERE id = $1 AND status = 'pending' AND unlocks_at <= NOW()
     RETURNING id`,
    [purgeId],
    tenantId,
  );

  return rows.length > 0;
}
