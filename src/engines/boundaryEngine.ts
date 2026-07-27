/**
 * Veridact — Coverage Boundary Engine
 *
 * Checks whether a ProposedAction is a full subset of a CoverageBoundary:
 *   1. action must be in allowed_actions
 *   2. resource_id must match at least one allowed_resource_pattern
 *   3. every constrained field in field_constraints must satisfy its constraint
 *   4. if require_all_params_constrained is set, every param key must appear
 *      in field_constraints (unlisted fields are otherwise allowed through)
 *
 * Fail-closed: any failed check returns DENY with a specific reason and
 * which check failed, for explainability.
 */

import type {
  BoundaryDecision,
  CoverageBoundary,
  FieldConstraint,
  ProposedAction,
} from '../types/boundary';

// ─── Glob Matching (supports only "*" wildcard) ────────────────────────────────

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

// ─── Field Constraint Checking ─────────────────────────────────────────────────

function satisfiesConstraint(value: unknown, constraint: FieldConstraint): boolean {
  if (constraint.numeric) {
    if (typeof value !== 'number') return false;
    const { min, max } = constraint.numeric;
    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;
  }

  if (constraint.allowed_values) {
    if (!constraint.allowed_values.includes(value)) return false;
  }

  return true;
}

// ─── Core: Check Boundary ───────────────────────────────────────────────────────

export function checkBoundary(
  action: ProposedAction,
  boundary: CoverageBoundary
): BoundaryDecision {
  if (!boundary.allowed_actions.includes(action.action)) {
    return {
      decision: 'DENY',
      boundary_id: boundary.boundary_id,
      reason: `Action "${action.action}" is not in this boundary's allowed_actions.`,
      failed_check: 'action',
    };
  }

  if (!matchesAnyPattern(action.resource_id, boundary.allowed_resource_patterns)) {
    return {
      decision: 'DENY',
      boundary_id: boundary.boundary_id,
      reason: `Resource "${action.resource_id}" does not match any allowed_resource_patterns.`,
      failed_check: 'resource_pattern',
    };
  }

  const constraints = boundary.field_constraints ?? {};

  for (const [field, constraint] of Object.entries(constraints)) {
    if (field in action.params) {
      const value = action.params[field];
      if (!satisfiesConstraint(value, constraint)) {
        return {
          decision: 'DENY',
          boundary_id: boundary.boundary_id,
          reason: `Field "${field}" with value ${JSON.stringify(value)} violates its constraint.`,
          failed_check: 'field_constraint',
          failed_field: field,
        };
      }
    }
  }

  if (boundary.require_all_params_constrained) {
    for (const field of Object.keys(action.params)) {
      if (!(field in constraints)) {
        return {
          decision: 'DENY',
          boundary_id: boundary.boundary_id,
          reason: `Field "${field}" is not covered by any field_constraint, and this boundary requires all params to be explicitly constrained.`,
          failed_check: 'field_constraint',
          failed_field: field,
        };
      }
    }
  }

  return {
    decision: 'ALLOW',
    boundary_id: boundary.boundary_id,
    reason: `Action "${action.action}" on "${action.resource_id}" is within the authorized boundary.`,
    failed_check: null,
  };
}
