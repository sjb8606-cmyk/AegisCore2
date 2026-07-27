/**
 * Veridact — Unit Tests: Intake Engine
 */

import { describe, it, expect } from 'vitest';
import {
  createIntakeState,
  processTurn,
  appendAiTurn,
  freezeIntake,
  toVerifyInput,
} from '../../src/engines/intakeEngine';
import type { IntakeSchema } from '../../src/types/intake';

const schema: IntakeSchema = {
  schema_id: 'clinic-intake-v1',
  tenant_id: 'tenant-1',
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
    {
      slot_id: 'reason',
      description: 'Free-text reason for the call',
      type: 'string',
      required: false,
      prompt: 'Can you briefly describe the reason for your call?',
    },
  ],
};

describe('intakeEngine', () => {
  it('starts with an empty, incomplete state', () => {
    const state = createIntakeState(schema);
    expect(state.complete).toBe(false);
    expect(state.collected).toEqual({});
  });

  it('fills the enum slot when a matching value appears in text', () => {
    const state = createIntakeState(schema);
    const result = processTurn(state, schema, "I'd like to book an appointment please");
    expect(result.state.collected.topic).toBe('appointment');
    expect(result.next_prompt).toBe('Are you an existing patient with us?');
  });

  it('re-asks the same prompt when extraction fails', () => {
    const state = createIntakeState(schema);
    const result = processTurn(state, schema, 'umm not sure honestly');
    expect(result.state.collected.topic).toBeUndefined();
    expect(result.next_prompt).toBe(schema.slots[0].prompt);
  });

  it('fills a boolean slot from yes/no language', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'billing question').state;
    const result = processTurn(state, schema, 'yes I am');
    expect(result.state.collected.is_existing_patient).toBe(true);
  });

  it('fills a boolean slot with a negative answer', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'billing question').state;
    const result = processTurn(state, schema, 'no, first time calling');
    expect(result.state.collected.is_existing_patient).toBe(false);
  });

  it('marks complete once all required slots are filled (optional string slot skipped)', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'appointment').state;
    const result = processTurn(state, schema, 'yes');
    expect(result.state.complete).toBe(true);
    expect(result.next_prompt).toBeNull();
  });

  it('does not advance past a completed conversation', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'appointment').state;
    state = processTurn(state, schema, 'yes').state;
    const result = processTurn(state, schema, 'anything else I say now');
    expect(result.next_prompt).toBeNull();
    expect(result.state.turns.length).toBe(3);
  });

  it('appendAiTurn records an AI turn without touching collected slots', () => {
    const state = createIntakeState(schema);
    const withAiTurn = appendAiTurn(state, schema.slots[0].prompt);
    expect(withAiTurn.turns).toHaveLength(1);
    expect(withAiTurn.turns[0].speaker).toBe('ai');
    expect(withAiTurn.collected).toEqual({});
  });

  it('freezeIntake reports missing_required_slots when intake ended early', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'appointment').state;
    const artifact = freezeIntake(state, schema);
    expect(artifact.missing_required_slots).toEqual(['is_existing_patient']);
    expect(artifact.collected.topic).toBe('appointment');
  });

  it('freezeIntake reports no missing slots when fully complete', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'appointment').state;
    state = processTurn(state, schema, 'yes').state;
    const artifact = freezeIntake(state, schema);
    expect(artifact.missing_required_slots).toEqual([]);
  });

  it('toVerifyInput passes through collected fields as the verify input', () => {
    let state = createIntakeState(schema);
    state = processTurn(state, schema, 'billing').state;
    state = processTurn(state, schema, 'yes').state;
    const artifact = freezeIntake(state, schema);
    const input = toVerifyInput(artifact);
    expect(input).toEqual({ topic: 'billing', is_existing_patient: true });
  });

  it('extracts a number slot correctly when present', () => {
    const numberSchema: IntakeSchema = {
      schema_id: 'num-test',
      tenant_id: 'tenant-1',
      slots: [
        {
          slot_id: 'account_number',
          description: 'Account number',
          type: 'number',
          required: true,
          prompt: "What's your account number?",
        },
      ],
    };
    const state = createIntakeState(numberSchema);
    const result = processTurn(state, numberSchema, "It's 48213");
    expect(result.state.collected.account_number).toBe(48213);
    expect(result.state.complete).toBe(true);
  });
});
