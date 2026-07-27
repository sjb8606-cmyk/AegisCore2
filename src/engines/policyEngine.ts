/**
 * Veridact — Policy Rule Evaluator
 *
 * Evaluates a structured input against a PolicyBundle.
 * Rules are checked in ascending priority order; first full match wins.
 * Fail-closed: if no rule matches, bundle.default_effect applies (should be 'DENY').
 *
 * This is the real implementation behind receiptEngine.ts:computeDecision(),
 * replacing the "input non-empty → PASS" stub.
 */

import type {
  PolicyBundle,
  PolicyCondition,
  PolicyDecision,
  PolicyRule,
} from '../types/policy';

// ─── Field Access ──────────────────────────────────────────────────────────────

function getField(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, input);
}

// ─── Condition Evaluation ──────────────────────────────────────────────────────

function evaluateCondition(input: Record<string, unknown>, condition: PolicyCondition): boolean {
  const actual = getField(input, condition.field);

  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'gt':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'gte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lt':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'lte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case 'contains':
      if (typeof actual === 'string' && typeof condition.value === 'string') {
        return actual.toLowerCase().includes(condition.value.toLowerCase());
      }
      if (Array.isArray(actual)) {
        return actual.includes(condition.value);
      }
      return false;
    default:
      return false;
  }
}

function ruleMatches(input: Record<string, unknown>, rule: PolicyRule): boolean {
  if (rule.conditions.length === 0) return true; // unconditional rule
  return rule.conditions.every((condition) => evaluateCondition(input, condition));
}

// ─── Core: Evaluate Policy ──────────────────────────────────────────────────────

export function evaluatePolicy(
  input: Record<string, unknown>,
  bundle: PolicyBundle
): PolicyDecision {
  const sortedRules = [...bundle.rules].sort((a, b) => a.priority - b.priority);
  const evaluatedRuleIds: string[] = [];

  for (const rule of sortedRules) {
    evaluatedRuleIds.push(rule.rule_id);
    if (ruleMatches(input, rule)) {
      return {
        decision: rule.effect,
        requires_hitl: rule.effect === 'ALLOW' && !!rule.requires_hitl,
        matched_rule_id: rule.rule_id,
        reason: rule.reason,
        evaluated_rules: evaluatedRuleIds,
      };
    }
  }

  // Fail-closed default
  return {
    decision: bundle.default_effect,
    requires_hitl: false,
    matched_rule_id: null,
    reason: `No rule matched — defaulted to ${bundle.default_effect} (fail-closed)`,
    evaluated_rules: evaluatedRuleIds,
  };
}
