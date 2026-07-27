/**
 * Veridact — Unit Tests: Policy Rule Evaluator
 */

import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/engines/policyEngine';
import type { PolicyBundle } from '../../src/types/policy';

const bundle: PolicyBundle = {
  rules_version: '1.0.0',
  rules_hash: 'a'.repeat(64),
  default_effect: 'DENY',
  rules: [
    {
      rule_id: 'no-medical-advice',
      description: 'Block medical advice questions',
      priority: 1,
      conditions: [{ field: 'topic', operator: 'eq', value: 'medical_advice' }],
      effect: 'DENY',
      reason: 'AI is not authorized to give medical advice.',
    },
    {
      rule_id: 'allow-appointment-scheduling',
      description: 'Allow scheduling requests',
      priority: 2,
      conditions: [{ field: 'topic', operator: 'eq', value: 'appointment' }],
      effect: 'ALLOW',
      reason: 'Scheduling is within the allowed boundary.',
    },
    {
      rule_id: 'allow-billing-with-review',
      description: 'Allow billing questions but require human review',
      priority: 3,
      conditions: [{ field: 'topic', operator: 'eq', value: 'billing' }],
      effect: 'ALLOW',
      requires_hitl: true,
      reason: 'Billing questions are allowed but require human sign-off.',
    },
  ],
};

describe('evaluatePolicy', () => {
  it('denies medical advice questions', () => {
    const result = evaluatePolicy({ topic: 'medical_advice' }, bundle);
    expect(result.decision).toBe('DENY');
    expect(result.matched_rule_id).toBe('no-medical-advice');
  });

  it('allows appointment scheduling', () => {
    const result = evaluatePolicy({ topic: 'appointment' }, bundle);
    expect(result.decision).toBe('ALLOW');
    expect(result.requires_hitl).toBe(false);
  });

  it('allows billing but flags requires_hitl', () => {
    const result = evaluatePolicy({ topic: 'billing' }, bundle);
    expect(result.decision).toBe('ALLOW');
    expect(result.requires_hitl).toBe(true);
  });

  it('fails closed (DENY) when no rule matches', () => {
    const result = evaluatePolicy({ topic: 'unknown_topic' }, bundle);
    expect(result.decision).toBe('DENY');
    expect(result.matched_rule_id).toBeNull();
    expect(result.reason).toContain('fail-closed');
  });

  it('evaluates rules in priority order and stops at first match', () => {
    const result = evaluatePolicy({ topic: 'medical_advice' }, bundle);
    expect(result.evaluated_rules).toEqual(['no-medical-advice']);
  });

  it('handles nested field paths', () => {
    const nestedBundle: PolicyBundle = {
      ...bundle,
      rules: [
        {
          rule_id: 'nested-check',
          description: 'Block calls originating from an unverified source',
          priority: 1,
          conditions: [{ field: 'context.source', operator: 'eq', value: 'phone' }],
          effect: 'DENY',
          reason: 'Phone-sourced context requires additional verification.',
        },
      ],
    };
    const result = evaluatePolicy({ context: { source: 'phone' } }, nestedBundle);
    expect(result.decision).toBe('DENY');
  });

  it('unconditional rule (no conditions) always matches', () => {
    const catchAll: PolicyBundle = {
      ...bundle,
      rules: [
        {
          rule_id: 'catch-all-deny',
          description: 'Deny everything not explicitly allowed above',
          priority: 99,
          conditions: [],
          effect: 'DENY',
          reason: 'No specific allow rule matched.',
        },
      ],
    };
    const result = evaluatePolicy({ topic: 'anything' }, catchAll);
    expect(result.decision).toBe('DENY');
    expect(result.matched_rule_id).toBe('catch-all-deny');
  });
});
