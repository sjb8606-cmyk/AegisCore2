/**
 * Veridact — Unit Tests: Routing Engine
 */

import { describe, it, expect } from 'vitest';
import { route, buildTransferAction } from '../../src/engines/routingEngine';
import type { RoutingTable, AvailabilityMap } from '../../src/types/routing';

const table: RoutingTable = {
  table_id: 'clinic-routing-v1',
  tenant_id: 'tenant-1',
  targets: [
    { target_id: 'billing-team', department: 'Billing', description: 'Billing dept' },
    { target_id: 'nurse-line', department: 'Nursing', description: 'Nurse line' },
    { target_id: 'general-queue', department: 'General', description: 'General queue' },
    { target_id: 'supervisor', department: 'Supervisor', description: 'Supervisor escalation' },
  ],
  rules: [
    {
      rule_id: 'route-billing',
      priority: 1,
      conditions: [{ field: 'intent', operator: 'eq', value: 'billing_inquiry' }],
      target_id: 'billing-team',
    },
    {
      rule_id: 'route-medical',
      priority: 2,
      conditions: [{ field: 'intent', operator: 'eq', value: 'medical_question' }],
      target_id: 'nurse-line',
    },
  ],
  fallback_target_id: 'general-queue',
  escalation_target_id: 'supervisor',
};

describe('route', () => {
  it('routes to the matching target when it is available', () => {
    const availability: AvailabilityMap = { 'billing-team': true };
    const result = route({ intent: 'billing_inquiry' }, table, availability);
    expect(result.decision).toBe('ROUTED');
    expect(result.target_id).toBe('billing-team');
    expect(result.department).toBe('Billing');
  });

  it('escalates when the matched target is unavailable but escalation target is available', () => {
    const availability: AvailabilityMap = { supervisor: true };
    const result = route({ intent: 'billing_inquiry' }, table, availability);
    expect(result.decision).toBe('ESCALATED');
    expect(result.target_id).toBe('supervisor');
  });

  it('queues when matched target and escalation target are both unavailable', () => {
    const availability: AvailabilityMap = {};
    const result = route({ intent: 'billing_inquiry' }, table, availability);
    expect(result.decision).toBe('QUEUED');
    expect(result.target_id).toBeNull();
  });

  it('falls back to the fallback target when no rule matches', () => {
    const availability: AvailabilityMap = { 'general-queue': true };
    const result = route({ intent: 'something_unrelated' }, table, availability);
    expect(result.decision).toBe('ROUTED');
    expect(result.target_id).toBe('general-queue');
    expect(result.matched_rule_id).toBeNull();
  });

  it('queues when no rule matches and fallback is unavailable', () => {
    const availability: AvailabilityMap = {};
    const result = route({ intent: 'something_unrelated' }, table, availability);
    expect(result.decision).toBe('QUEUED');
  });

  it('treats a target missing from the availability map as unavailable (fail-closed)', () => {
    const availability: AvailabilityMap = { 'nurse-line': false };
    const result = route({ intent: 'medical_question' }, table, availability);
    expect(result.decision).not.toBe('ROUTED');
  });

  it('respects rule priority order', () => {
    const conflictingTable: RoutingTable = {
      ...table,
      rules: [
        { ...table.rules[1], priority: 1 },
        { ...table.rules[0], priority: 2 },
      ],
    };
    const availability: AvailabilityMap = { 'billing-team': true, 'nurse-line': true };
    const result = route({ intent: 'medical_question' }, conflictingTable, availability);
    expect(result.target_id).toBe('nurse-line');
  });
});

describe('buildTransferAction', () => {
  it('builds a transfer_to_human action for a ROUTED decision', () => {
    const decision = route({ intent: 'billing_inquiry' }, table, { 'billing-team': true });
    const action = buildTransferAction(decision);
    expect(action).not.toBeNull();
    expect(action?.action).toBe('transfer_to_human');
    expect(action?.resource_id).toBe('department:Billing');
    expect(action?.params.target_id).toBe('billing-team');
    expect(action?.params.escalated).toBe(false);
  });

  it('marks escalated:true for an ESCALATED decision', () => {
    const decision = route({ intent: 'billing_inquiry' }, table, { supervisor: true });
    const action = buildTransferAction(decision);
    expect(action?.params.escalated).toBe(true);
  });

  it('returns null for a QUEUED decision', () => {
    const decision = route({ intent: 'billing_inquiry' }, table, {});
    const action = buildTransferAction(decision);
    expect(action).toBeNull();
  });
});
