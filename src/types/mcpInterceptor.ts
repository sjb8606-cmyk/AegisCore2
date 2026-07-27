/**
 * Veridact — MCP Interceptor Types
 *
 * The interceptor is the assembly point: every proposed AI tool call passes
 * through Coverage Boundary, then the Policy Rule Evaluator, then — if the
 * matched policy rule requires it — the HITL Gate, in that fixed order.
 *
 * Outcomes:
 *   DENIED       — blocked by boundary or policy. Terminal.
 *   PENDING_HITL — allowed by policy, but a named human must approve before
 *                  it may proceed. Not yet authorized to execute.
 *   ALLOWED      — cleared to execute immediately.
 */

import type { BoundaryDecision, CoverageBoundary, ProposedAction } from './boundary';
import type { PolicyBundle, PolicyDecision } from './policy';

export type InterceptorOutcome = 'ALLOWED' | 'DENIED' | 'PENDING_HITL';

export interface InterceptResult {
  outcome: InterceptorOutcome;
  proposed_action: ProposedAction;
  boundary_decision: BoundaryDecision;
  policy_decision: PolicyDecision | null;
  approval_id: string | null;
  reason: string;
}

export interface InterceptParams {
  tenantId: string;
  action: ProposedAction;
  boundary: CoverageBoundary;
  policyBundle: PolicyBundle;
  assignedApproverId?: string;
  hitlTtlSeconds?: number;
}
