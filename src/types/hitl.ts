/**
 * Veridact — HITL (Human-In-The-Loop) Gate Types
 *
 * A PendingApproval freezes a proposed action and requires a named human
 * (assigned_approver_id) to explicitly approve or reject it before it may
 * proceed. No silent automation: an action tied to a HITL gate is never
 * authorized just because time passed or nobody objected — it is either
 * explicitly APPROVED, explicitly REJECTED, or EXPIRED (which is itself a
 * terminal, non-authorizing state, not a fallback approval).
 */

import type { ProposedAction } from './boundary';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface PendingApproval {
  approval_id: string;
  tenant_id: string;
  proposed_action: ProposedAction;
  assigned_approver_id: string;
  reason: string;
  created_at: string;
  expires_at: string;
  status: ApprovalStatus;
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
}

export interface CreateApprovalParams {
  tenantId: string;
  proposedAction: ProposedAction;
  assignedApproverId: string;
  reason: string;
  ttlSeconds: number;
}

export interface ResolveApprovalParams {
  resolverId: string;
  decision: ApprovalDecision;
  note?: string;
}
