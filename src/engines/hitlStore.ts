/**
 * Veridact — HITL Approval Store
 *
 * In-memory registry of PendingApprovals, keyed by approval_id.
 * Wraps the pure hitlGate functions with tenant-scoped lookup and persistence.
 *
 * SWAP: replace with a DB-backed store (approvals table, RLS-scoped like
 * receipts/changes/alerts) before production — pending approvals must
 * survive process restarts.
 */

import type {
  ApprovalDecision,
  CreateApprovalParams,
  PendingApproval,
} from '../types/hitl';
import { createPendingApproval, resolveApproval, getEffectiveStatus } from './hitlGate';

const APPROVALS = new Map<string, PendingApproval>();

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

export function createApproval(params: CreateApprovalParams): PendingApproval {
  const approval = createPendingApproval(params);
  APPROVALS.set(approval.approval_id, approval);
  return approval;
}

export function getApproval(approvalId: string, tenantId: string): PendingApproval {
  const approval = APPROVALS.get(approvalId);
  if (!approval) {
    throw new ApprovalNotFoundError(approvalId);
  }
  if (approval.tenant_id !== tenantId) {
    throw new ApprovalTenantMismatchError(approvalId, tenantId);
  }
  return getEffectiveStatus(approval).approval;
}

export function resolveApprovalById(
  approvalId: string,
  tenantId: string,
  resolverId: string,
  decision: ApprovalDecision,
  note?: string
): PendingApproval {
  const existing = getApproval(approvalId, tenantId);
  const resolved = resolveApproval(existing, resolverId, decision, note);
  APPROVALS.set(approvalId, resolved);
  return resolved;
}

export function listPendingForApprover(approverId: string, tenantId: string): PendingApproval[] {
  return Array.from(APPROVALS.values())
    .filter((a) => a.tenant_id === tenantId && a.assigned_approver_id === approverId)
    .map((a) => getEffectiveStatus(a).approval)
    .filter((a) => a.status === 'PENDING');
}
