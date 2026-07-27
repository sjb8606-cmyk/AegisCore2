/**
 * Veridact — Policy Rule Evaluator Types
 * Fail-closed decision model: if nothing matches, default_effect applies.
 */

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in' | 'contains' | 'exists' | 'not_exists';

export interface PolicyCondition {
  field: string;           // dot-path into input, e.g. "topic" or "context.source"
  operator: ConditionOperator;
  value?: unknown;         // not required for exists/not_exists
}

export type PolicyEffect = 'ALLOW' | 'DENY';

export interface PolicyRule {
  rule_id: string;
  description: string;
  priority: number;        // lower number = evaluated first
  conditions: PolicyCondition[]; // ALL must match (AND) for this rule to fire
  effect: PolicyEffect;
  requires_hitl?: boolean;  // if true and effect is ALLOW, still requires human approval
  reason: string;           // human-readable reason surfaced when this rule fires
}

export interface PolicyBundle {
  rules_version: string;
  rules_hash: string;
  default_effect: PolicyEffect; // fail-closed default — should be 'DENY'
  rules: PolicyRule[];
}

export interface PolicyDecision {
  decision: PolicyEffect;
  requires_hitl: boolean;
  matched_rule_id: string | null;
  reason: string;
  evaluated_rules: string[]; // rule_ids checked, in order — for explainability
}
