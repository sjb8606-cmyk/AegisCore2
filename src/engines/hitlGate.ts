/**
 * Veridact — HITL Gate Engine
 *
 * Pure, deterministic core logic for the human-approval lifecycle. All
 * functions take an explicit `now` (defaulting to the real clock at the
 * call site) so behavior around expiry is fully testable without relying
 * on real elapsed time.
 *
 * Lifecycle: PENDING → APPROVED | REJECTED | EXPIRED (terminal states).
 * Expiry is never an implicit approval — an expired approval is not
 * authorized and must be re-requested.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ApprovalDecision,
  CreateApprovalParams,
  PendingApproval,
} from '../types/hitl';

export class ApprovalAlreadyResolvedError extends Error {
  statusCode = 400;
  constructor(approvalId: string, currentStatus: string) {
    super(`Approval "${approvalId}" is already resolved (status: ${currentStatus})`);
    this.name = 'ApprovalAlreadyResolvedError';
  }
}

export class ApprovalExpiredError extends Error {
  statusCode = 400;
  constructor(approvalId: string) {
    super(`Approval "${approvalId}" has expired and can no longer be resolved`);
    this.name = 'ApprovalExpiredError';
  }
}

export class UnauthorizedApproverError extends Error {
  statusCode = 403;
  constructor(approvalId: string, resolverId: string) {
    super(`"${resolverId}" is not the assigned approver for approval "${approvalId}"`);
    this.name = 'UnauthorizedApproverError';
  }
}

export function createPendingApproval(
  params: CreateApprovalParams,
  now: Date = new Date()
): PendingApproval {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + params.ttlSeconds * 1000).toISOString();

  return {
    approval_id: uuidv4(),
    tenant_id: params.tenantId,
    proposed_action: params.proposedAction,
    assigned_approver_id: params.assignedApproverId,
    reason: params.reason,
    created_at: createdAt,
    expires_at: expiresAt,
    status: 'PENDING',
  };
}

interface ApprovalStatusResult {
  status: PendingApproval['status'];
  approval: PendingApproval;
}

export function getEffectiveStatus(
  approval: PendingApproval,
  now: Date = new Date()
): ApprovalStatusResult {
  if (approval.status !== 'PENDING') {
    return { status: approval.status, approval };
  }
  if (now.getTime() >= new Date(approval.expires_at).getTime()) {
    return { status: 'EXPIRED', approval: { ...approval, status: 'EXPIRED' } };
  }
  return { status: 'PENDING', approval };
}

export function resolveApproval(
  approval: PendingApproval,
  resolverId: string,
  decision: ApprovalDecision,
  note: string | undefined,
  now: Date = new Date()
): PendingApproval {
  const { status: effectiveStatus } = getEffectiveStatus(approval, now);

  if (effectiveStatus === 'EXPIRED') {
    throw new ApprovalExpiredError(approval.approval_id);
  }
  if (effectiveStatus !== 'PENDING') {
    throw new ApprovalAlreadyResolvedError(approval.approval_id, effectiveStatus);
  }
  if (resolverId !== approval.assigned_approver_id) {
    throw new UnauthorizedApproverError(approval.approval_id, resolverId);
  }

  return {
    ...approval,
    status: decision,
    resolved_at: now.toISOString(),
    resolved_by: resolverId,
    resolution_note: note,
  };
}

export function isActionAuthorized(approval: PendingApproval, now: Date = new Date()): boolean {
  const { status } = getEffectiveStatus(approval, now);
  return status === 'APPROVED';
}
