/**
 * Veridact — MCP Interceptor
 *
 * Assembles Cores 1, 2, and 6 into a single pipeline for every proposed
 * AI tool call:
 *
 *   1. Coverage Boundary — is this action/resource within what's authorized at all?
 *   2. Policy Rule Evaluator — does tenant policy allow it, and does it require HITL?
 *   3. HITL Gate — if required, freeze the action pending named human approval.
 *
 * Fail-closed at every step: a boundary DENY or policy DENY stops the
 * pipeline immediately. A policy ALLOW with requires_hitl cannot proceed
 * without an assigned approver — omitting one is an error, not a silent skip.
 *
 * NOW ASYNC: createApproval (hitlStore) is DB-backed, so interceptAction
 * must be awaited. checkBoundary and evaluatePolicy remain pure/synchronous —
 * they operate on boundary/bundle objects passed in directly, not looked up
 * from a store.
 */

import { checkBoundary } from './boundaryEngine';
import { evaluatePolicy } from './policyEngine';
import { createApproval } from './hitlStore';
import type { InterceptParams, InterceptResult } from '../types/mcpInterceptor';

const DEFAULT_HITL_TTL_SECONDS = 3600;

export class MissingApproverError extends Error {
  statusCode = 400;
  constructor(action: string) {
    super(
      `Policy requires HITL approval for action "${action}", but no assignedApproverId was provided.`
    );
    this.name = 'MissingApproverError';
  }
}

function buildPolicyInput(action: InterceptParams['action']): Record<string, unknown> {
  return {
    ...action.params,
    action: action.action,
    resource_id: action.resource_id,
  };
}

export async function interceptAction(params: InterceptParams): Promise<InterceptResult> {
  const { tenantId, action, boundary, policyBundle, assignedApproverId, hitlTtlSeconds } = params;

  const boundaryDecision = checkBoundary(action, boundary);

  if (boundaryDecision.decision === 'DENY') {
    return {
      outcome: 'DENIED',
      proposed_action: action,
      boundary_decision: boundaryDecision,
      policy_decision: null,
      approval_id: null,
      reason: boundaryDecision.reason,
    };
  }

  const policyInput = buildPolicyInput(action);
  const policyDecision = evaluatePolicy(policyInput, policyBundle);

  if (policyDecision.decision === 'DENY') {
    return {
      outcome: 'DENIED',
      proposed_action: action,
      boundary_decision: boundaryDecision,
      policy_decision: policyDecision,
      approval_id: null,
      reason: policyDecision.reason,
    };
  }

  if (policyDecision.requires_hitl) {
    if (!assignedApproverId) {
      throw new MissingApproverError(action.action);
    }

    const approval = await createApproval({
      tenantId,
      proposedAction: action,
      assignedApproverId,
      reason: policyDecision.reason,
      ttlSeconds: hitlTtlSeconds ?? DEFAULT_HITL_TTL_SECONDS,
    });

    return {
      outcome: 'PENDING_HITL',
      proposed_action: action,
      boundary_decision: boundaryDecision,
      policy_decision: policyDecision,
      approval_id: approval.approval_id,
      reason: 'Action is allowed by policy but requires human approval before it may proceed.',
    };
  }

  return {
    outcome: 'ALLOWED',
    proposed_action: action,
    boundary_decision: boundaryDecision,
    policy_decision: policyDecision,
    approval_id: null,
    reason: policyDecision.reason,
  };
}
