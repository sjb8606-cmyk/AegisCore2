/**
 * Veridact — Unit Tests: Front Door Orchestrator
 *
 * Exercises the full Intake → Intent → Routing pipeline together,
 * simulating a real clinic call end to end.
 */

import { describe, it, expect } from 'vitest';
import { createIntakeState, processTurn } from '../../src/engines/intakeEngine';
import { finalizeConversation } from '../../src/engines/frontDoorOrchestrator';
import type { IntakeSchema } from '../../src/types/intake';
import type { IntentSchema } from '../../src/types/intent';
import type { AvailabilityMap, RoutingTable } from '../../src/types/routing';

const intakeSchema: IntakeSchema = {
  schema_id: 'clinic-intake-v1',
  tenant_id: 'tenant-orchestrator',
  slots: [
    {
      slot_id: 'topic',
      description: 'What the caller wants',
      type: 'enum',
      required: true,
      enum_values: ['appointment', 'billing', 'medical_advice'],
      prompt: 'Are you calling about an appointment, billing, or a medical question?',
    },
    {
      slot_id: 'is_existing_patient',
      description: 'Whether caller is an existing patient',
      type: 'boolean',
      required: true,
      prompt: 'Are you an existing patient with us?',
    },
  ],
};

const intentSchema: IntentSchema = {
  schema_id: 'clinic-intent-v1',
  tenant_id: 'tenant-orchestrator',
  unknown_intent_id: 'unknown',
  intents: [
    {
      intent_id: 'cancellation',
      description: 'Caller wants to cancel',
      keywords: ['cancel'],
      priority: 1,
    },
    {
      intent_id: 'billing_inquiry',
      description: 'Billing question',
      keywords: ['bill', 'charge', 'invoice'],
      priority: 2,
    },
  ],
};

const routingTable: RoutingTable = {
  table_id: 'clinic-routing-v1',
  tenant_id: 'tenant-orchestrator',
  targets: [
    { target_id: 'billing-team', department: 'Billing', description: 'Billing dept' },
    { target_id: 'general-queue', department: 'General', description: 'General queue' },
  ],
  rules: [
    {
      rule_id: 'route-billing-intent',
      priority: 1,
      conditions: [{ field: 'intent', operator: 'eq', value: 'billing_inquiry' }],
      target_id: 'billing-team',
    },
  ],
  fallback_target_id: 'general-queue',
  escalation_target_id: null,
};

describe('finalizeConversation', () => {
  it('runs a full billing call end to end: intake → intent → routing', () => {
    let state = createIntakeState(intakeSchema);
    state = processTurn(state, intakeSchema, 'I have a question about a charge on my bill').state;
    state = processTurn(state, intakeSchema, 'billing').state;
    state = processTurn(state, intakeSchema, 'yes, existing patient').state;

    expect(state.complete).toBe(true);

    const availability: AvailabilityMap = { 'billing-team': true };
    const outcome = finalizeConversation({
      intakeState: state,
      intakeSchema,
      intentSchema,
      routingTable,
      availability,
    });

    expect(outcome.artifact.missing_required_slots).toEqual([]);
    expect(outcome.verify_input.topic).toBe('billing');
    expect(outcome.intent_classification.intent).toBe('billing_inquiry');
    expect(outcome.routing_decision.decision).toBe('ROUTED');
    expect(outcome.routing_decision.target_id).toBe('billing-team');
    expect(outcome.transfer_action).not.toBeNull();
    expect(outcome.transfer_action?.action).toBe('transfer_to_human');
  });

  it('falls back to the general queue when intent does not match any routing rule', () => {
    let state = createIntakeState(intakeSchema);
    state = processTurn(state, intakeSchema, 'appointment').state;
    state = processTurn(state, intakeSchema, 'yes').state;

    const availability: AvailabilityMap = { 'general-queue': true };
    const outcome = finalizeConversation({
      intakeState: state,
      intakeSchema,
      intentSchema,
      routingTable,
      availability,
    });

    expect(outcome.intent_classification.intent).toBe('unknown');
    expect(outcome.routing_decision.decision).toBe('ROUTED');
    expect(outcome.routing_decision.target_id).toBe('general-queue');
  });

  it('produces a QUEUED outcome (and null transfer_action) when nobody is available', () => {
    let state = createIntakeState(intakeSchema);
    state = processTurn(state, intakeSchema, 'question about my invoice').state;
    state = processTurn(state, intakeSchema, 'yes').state;

    const outcome = finalizeConversation({
      intakeState: state,
      intakeSchema,
      intentSchema,
      routingTable,
      availability: {},
    });

    expect(outcome.routing_decision.decision).toBe('QUEUED');
    expect(outcome.transfer_action).toBeNull();
  });

  it('still produces an artifact and reports missing slots if the call ends early', () => {
    let state = createIntakeState(intakeSchema);
    state = processTurn(state, intakeSchema, 'billing question about a charge').state;

    const outcome = finalizeConversation({
      intakeState: state,
      intakeSchema,
      intentSchema,
      routingTable,
      availability: { 'billing-team': true },
    });

    expect(outcome.artifact.missing_required_slots).toEqual(['is_existing_patient']);
    expect(outcome.intent_classification.intent).toBe('billing_inquiry');
  });
});
