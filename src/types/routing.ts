/**
 * Veridact — Routing Engine Types
 *
 * Decides which department/human a request should go to, based on the
 * already-collected input (typically intent/topic from Intent Classification
 * or Intake). Availability is supplied per-call rather than stored on the
 * target — "who's free right now" is live, time-dependent data, not
 * something a deterministic rule set should hold internally.
 *
 * Fail-closed: a target with no explicit availability=true entry is treated
 * as unavailable, and an unmatched request falls back to a queue rather
 * than silently dropping.
 */

export type RoutingConditionOperator = 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists';

export interface RoutingCondition {
  field: string;
  operator: RoutingConditionOperator;
  value?: unknown;
}

export interface RoutingTarget {
  target_id: string;
  department: string;
  description: string;
}

export interface RoutingRule {
  rule_id: string;
  priority: number; // lower = evaluated first
  conditions: RoutingCondition[]; // ALL must match (AND)
  target_id: string;
}

export interface RoutingTable {
  table_id: string;
  tenant_id: string;
  targets: RoutingTarget[];
  rules: RoutingRule[];
  fallback_target_id: string | null; // used when no rule matches
  escalation_target_id: string | null; // used when the matched target is unavailable
}

export type AvailabilityMap = Record<string, boolean>; // target_id -> is currently available

export type RoutingDecisionType = 'ROUTED' | 'ESCALATED' | 'QUEUED';

export interface RoutingDecision {
  decision: RoutingDecisionType;
  target_id: string | null;
  department: string | null;
  reason: string;
  matched_rule_id: string | null;
}
