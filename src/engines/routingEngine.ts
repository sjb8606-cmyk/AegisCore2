/**
 * Veridact — Routing Engine
 *
 * Determines which department/target a request should be routed to.
 *
 * Flow:
 *  1. Find the first rule (priority order) whose conditions match the input.
 *  2. If a rule matches, check whether its target is currently available.
 *     - available    → ROUTED to that target
 *     - unavailable  → ESCALATED to escalation_target_id (if available itself),
 *                       otherwise QUEUED
 *  3. If no rule matches at all, fall back to fallback_target_id
 *     (same available/unavailable handling), or QUEUED if there's no fallback.
 *
 * Availability defaults to unavailable (fail-closed) for any target not
 * explicitly marked true in the AvailabilityMap.
 */

import type {
  AvailabilityMap,
  RoutingCondition,
  RoutingDecision,
  RoutingRule,
  RoutingTable,
  RoutingTarget,
} from '../types/routing';

function getField(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, input);
}

function evaluateCondition(input: Record<string, unknown>, condition: RoutingCondition): boolean {
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
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    default:
      return false;
  }
}

function ruleMatches(input: Record<string, unknown>, rule: RoutingRule): boolean {
  if (rule.conditions.length === 0) return true;
  return rule.conditions.every((condition) => evaluateCondition(input, condition));
}

function isAvailable(targetId: string | null, availability: AvailabilityMap): boolean {
  if (!targetId) return false;
  return availability[targetId] === true;
}

function findTarget(table: RoutingTable, targetId: string): RoutingTarget | undefined {
  return table.targets.find((t) => t.target_id === targetId);
}

function routeToFallbackOrQueue(
  table: RoutingTable,
  availability: AvailabilityMap,
  matchedRuleId: string | null
): RoutingDecision {
  if (table.fallback_target_id && isAvailable(table.fallback_target_id, availability)) {
    const target = findTarget(table, table.fallback_target_id);
    return {
      decision: 'ROUTED',
      target_id: table.fallback_target_id,
      department: target?.department ?? null,
      reason: 'No rule matched — routed to fallback target.',
      matched_rule_id: matchedRuleId,
    };
  }

  return {
    decision: 'QUEUED',
    target_id: null,
    department: null,
    reason: 'No rule matched and no fallback target is currently available.',
    matched_rule_id: matchedRuleId,
  };
}

// ─── Core: Route ─────────────────────────────────────────────────────────────

export function route(
  input: Record<string, unknown>,
  table: RoutingTable,
  availability: AvailabilityMap
): RoutingDecision {
  const sortedRules = [...table.rules].sort((a, b) => a.priority - b.priority);
  const matched = sortedRules.find((rule) => ruleMatches(input, rule));

  if (!matched) {
    return routeToFallbackOrQueue(table, availability, null);
  }

  const target = findTarget(table, matched.target_id);

  if (isAvailable(matched.target_id, availability)) {
    return {
      decision: 'ROUTED',
      target_id: matched.target_id,
      department: target?.department ?? null,
      reason: `Matched rule "${matched.rule_id}" — target is available.`,
      matched_rule_id: matched.rule_id,
    };
  }

  if (table.escalation_target_id && isAvailable(table.escalation_target_id, availability)) {
    const escalationTarget = findTarget(table, table.escalation_target_id);
    return {
      decision: 'ESCALATED',
      target_id: table.escalation_target_id,
      department: escalationTarget?.department ?? null,
      reason: `Matched target for rule "${matched.rule_id}" is unavailable — escalated.`,
      matched_rule_id: matched.rule_id,
    };
  }

  return {
    decision: 'QUEUED',
    target_id: null,
    department: null,
    reason: `Matched target for rule "${matched.rule_id}" is unavailable and no escalation target is available.`,
    matched_rule_id: matched.rule_id,
  };
}

/**
 * Build a ProposedAction shape (matching Coverage Boundary / servicebot's
 * action pattern) for handing off a ROUTED or ESCALATED decision to a
 * transfer_to_human action handler.
 */
export function buildTransferAction(decision: RoutingDecision): {
  action: string;
  resource_id: string;
  params: Record<string, unknown>;
} | null {
  if (decision.decision === 'QUEUED' || !decision.target_id) {
    return null;
  }

  return {
    action: 'transfer_to_human',
    resource_id: `department:${decision.department ?? 'unknown'}`,
    params: {
      target_id: decision.target_id,
      reason: decision.reason,
      escalated: decision.decision === 'ESCALATED',
    },
  };
}
