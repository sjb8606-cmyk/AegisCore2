/**
 * Veridact — Coverage Boundary Types
 *
 * A CoverageBoundary defines exactly what an AI agent is authorized to touch:
 * which actions it may take, which resources those actions may target, and
 * what parameter values are permitted for each action.
 *
 * A proposed action is authorized only if it is a full subset of the
 * boundary — every action type, resource pattern, and constrained field
 * must fall within what's explicitly permitted. Fail-closed: anything not
 * explicitly covered is denied.
 */

export interface NumericConstraint {
  min?: number;
  max?: number;
}

export interface FieldConstraint {
  numeric?: NumericConstraint;
  allowed_values?: unknown[];
}

export interface CoverageBoundary {
  boundary_id: string;
  tenant_id: string;
  description: string;

  // Action types this boundary permits, e.g. ["revoke_api_key", "transfer_to_human"]
  allowed_actions: string[];

  // Glob-style patterns (only "*" wildcard supported) a resource_id must match
  // at least one of, e.g. ["customer:*", "invoice:INV-*"]
  allowed_resource_patterns: string[];

  // Per-field constraints on the action's params. A field not listed here
  // is unconstrained (any value passes) unless require_all_params_constrained is set.
  field_constraints?: Record<string, FieldConstraint>;

  // If true, any param field NOT present in field_constraints causes a DENY.
  // Defaults to false (unlisted fields pass through unconstrained).
  require_all_params_constrained?: boolean;
}

export interface ProposedAction {
  action: string;
  resource_id: string;
  params: Record<string, unknown>;
}

export interface BoundaryDecision {
  decision: 'ALLOW' | 'DENY';
  boundary_id: string | null;
  reason: string;
  failed_check: 'action' | 'resource_pattern' | 'field_constraint' | null;
  failed_field?: string;
}
