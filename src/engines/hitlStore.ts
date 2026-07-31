/**
 * Veridact — HITL Approval Store (DB-backed)
 *
 * Persists PendingApprovals to the hitl_approvals table, RLS-scoped by
 * tenant via withTenant(). Replaces the earlier in-memory Map.
 *
 * Wraps the pure hitlGate functions (createPendingApproval, resolveApproval,
 * getEffectiveStatus) — all business logic (expiry checking, approver
 * authorization, terminal-state enforcement) still lives there, unchanged.
 * This store is purely responsible for persistence and tenant-scoped lookup.
 *
 * Same RLS behavior note as boundaryStore: a lookup for an approval_id
 * belonging to a different tenant returns zero rows (filtered by RLS before
 * the app ever sees it), which surfaces as ApprovalNotFoundError — not a
 * distinct tenant-mismatch error.
 */

import { withTenant } from '../db/client';
import type {
  ApprovalDecision,
  CreateApprovalParams,
  PendingApproval,
} from '../types/hitl';
import { createPendingApproval, resolveApproval, getEffectiveStatus } from './hitlGate';

export class ApprovalNotFoundError extends Error {
  statusCode = 400;
  constructor(approvalId: string) {
    super(`No pending approval found with approval_id "${approvalId}"`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalTenantMismatchError extends Error {
  statusCode = 403;
  constructor(approvalId: string, tenantId: string) {
    super(`Approval "${approvalId}" does not belong to tenant "${tenantId}"`);
    this.name = 'ApprovalTenantMismatchError';
  }
}

function rowToApproval(row: Record<string, unknown>): PendingApproval {
  return {
    approval_id: row.approval_id as string,
    tenant_id: row.tenant_id as string,
    proposed_action: row.proposed_action as PendingApproval['proposed_action'],
    assigned_approver_id: row.assigned_approver_id as string,
    reason: row.reason as string,
    created_at: (row.created_at as Date).toISOString(),
    expires_at: (row.expires_at as Date).toISOString(),
    status: row.status as PendingApproval['status'],
    resolved_at: row.resolved_at ? (row.resolved_at as Date).toISOString() : undefined,
    resolved_by: (row.resolved_by as string) ?? undefined,
    resolution_note: (row.resolution_note as string) ?? undefined,
  };
}

export async function createApproval(params: CreateApprovalParams): Promise<PendingApproval> {
  const approval = createPendingApproval(params);

  return withTenant(params.tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO hitl_approvals (
        approval_id, tenant_id, proposed_action, assigned_approver_id,
        reason, created_at, expires_at, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING approval_id, tenant_id, proposed_action, assigned_approver_id,
                reason, created_at, expires_at, status, resolved_at, resolved_by, resolution_note`,
      [
        approval.approval_id,
        approval.tenant_id,
        JSON.stringify(approval.proposed_action),
        approval.assigned_approver_id,
        approval.reason,
        approval.created_at,
        approval.expires_at,
        approval.status,
      ]
    );
    return rowToApproval(res.rows[0]);
  });
}

export async function getApproval(approvalId: string, tenantId: string): Promise<PendingApproval> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT approval_id, tenant_id, proposed_action, assigned_approver_id,
              reason, created_at, expires_at, status, resolved_at, resolved_by, resolution_note
       FROM hitl_approvals
       WHERE approval_id = $1 AND deleted_at IS NULL`,
      [approvalId]
    );

    if (res.rows.length === 0) {
      throw new ApprovalNotFoundError(approvalId);
    }

    return getEffectiveStatus(rowToApproval(res.rows[0])).approval;
  });
}

export async function resolveApprovalById(
  approvalId: string,
  tenantId: string,
  resolverId: string,
  decision: ApprovalDecision,
  note?: string
): Promise<PendingApproval> {
  const existing = await getApproval(approvalId, tenantId);
  const resolved = resolveApproval(existing, resolverId, decision, note);

  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `UPDATE hitl_approvals
       SET status = $1, resolved_at = $2, resolved_by = $3, resolution_note = $4
       WHERE approval_id = $5 AND deleted_at IS NULL
       RETURNING approval_id, tenant_id, proposed_action, assigned_approver_id,
                 reason, created_at, expires_at, status, resolved_at, resolved_by, resolution_note`,
      [resolved.status, resolved.resolved_at, resolved.resolved_by, resolved.resolution_note ?? null, approvalId]
    );
    return rowToApproval(res.rows[0]);
  });
}

export async function listPendingForApprover(
  approverId: string,
  tenantId: string
): Promise<PendingApproval[]> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT approval_id, tenant_id, proposed_action, assigned_approver_id,
              reason, created_at, expires_at, status, resolved_at, resolved_by, resolution_note
       FROM hitl_approvals
       WHERE tenant_id = $1 AND assigned_approver_id = $2 AND status = 'PENDING' AND deleted_at IS NULL`,
      [tenantId, approverId]
    );

    return res.rows
      .map((row) => getEffectiveStatus(rowToApproval(row)).approval)
      .filter((a) => a.status === 'PENDING');
  });
}
