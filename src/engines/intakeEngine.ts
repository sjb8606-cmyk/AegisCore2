/**
 * Veridact — Intake Engine
 *
 * Deterministic slot-filling conversation engine. Turns raw customer speech
 * into a structured IntakeArtifact, one slot at a time, in a fixed priority
 * order defined by the tenant's IntakeSchema.
 *
 * Deliberately NOT an LLM-based extractor: per Veridact's "Deterministic
 * Reasoning" guarantee, the same conversation must always produce the same
 * artifact. Extraction rules per slot type:
 *   - enum:    text must contain one of enum_values (case-insensitive)
 *   - boolean: text must contain a yes/no-style keyword
 *   - number:  first numeric token found in the text
 *   - string:  the customer's raw utterance, trimmed
 *
 * If extraction fails for the active slot, the same prompt is re-issued —
 * the conversation does not advance until a valid answer is given.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ConversationTurn,
  IntakeArtifact,
  IntakeSchema,
  IntakeState,
  IntakeStepResult,
  SlotDefinition,
  SlotValue,
} from '../types/intake';

const YES_PATTERN = /\b(yes|yeah|yep|yup|correct|confirmed|affirmative)\b/i;
const NO_PATTERN = /\b(no|nope|not|negative|incorrect)\b/i;
const NUMBER_PATTERN = /-?\d+(\.\d+)?/;

// ─── State Creation ─────────────────────────────────────────────────────────

export function createIntakeState(schema: IntakeSchema): IntakeState {
  return {
    schema_id: schema.schema_id,
    tenant_id: schema.tenant_id,
    collected: {},
    turns: [],
    complete: false,
  };
}

// ─── Slot Selection ─────────────────────────────────────────────────────────

function getActiveSlot(
  schema: IntakeSchema,
  collected: Record<string, SlotValue>
): SlotDefinition | null {
  for (const slot of schema.slots) {
    if (slot.required && !(slot.slot_id in collected)) {
      return slot;
    }
  }
  return null;
}

function getMissingRequiredSlots(
  schema: IntakeSchema,
  collected: Record<string, SlotValue>
): string[] {
  return schema.slots
    .filter((slot) => slot.required && !(slot.slot_id in collected))
    .map((slot) => slot.slot_id);
}

// ─── Extraction ─────────────────────────────────────────────────────────────

function extractSlotValue(text: string, slot: SlotDefinition): SlotValue | undefined {
  switch (slot.type) {
    case 'enum': {
      const lower = text.toLowerCase();
      const match = (slot.enum_values ?? []).find((value) => lower.includes(value.toLowerCase()));
      return match;
    }
    case 'boolean': {
      if (YES_PATTERN.test(text)) return true;
      if (NO_PATTERN.test(text)) return false;
      return undefined;
    }
    case 'number': {
      const match = text.match(NUMBER_PATTERN);
      return match ? parseFloat(match[0]) : undefined;
    }
    case 'string': {
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    default:
      return undefined;
  }
}

// ─── Core: Process One Customer Turn ───────────────────────────────────────

export function processTurn(
  state: IntakeState,
  schema: IntakeSchema,
  customerText: string
): IntakeStepResult {
  const activeSlot = getActiveSlot(schema, state.collected);

  const turn: ConversationTurn = {
    turn_id: uuidv4(),
    speaker: 'customer',
    text: customerText,
    timestamp: new Date().toISOString(),
  };

  if (!activeSlot) {
    return {
      state: { ...state, turns: [...state.turns, turn], complete: true },
      next_prompt: null,
    };
  }

  const extracted = extractSlotValue(customerText, activeSlot);
  const newTurns = [...state.turns, turn];

  if (extracted === undefined) {
    return {
      state: { ...state, turns: newTurns },
      next_prompt: activeSlot.prompt,
    };
  }

  const newCollected = { ...state.collected, [activeSlot.slot_id]: extracted };
  const stillMissing = getMissingRequiredSlots(schema, newCollected);
  const nextSlot = stillMissing.length > 0 ? getActiveSlot(schema, newCollected) : null;

  return {
    state: {
      ...state,
      collected: newCollected,
      turns: newTurns,
      complete: stillMissing.length === 0,
    },
    next_prompt: nextSlot ? nextSlot.prompt : null,
  };
}

export function appendAiTurn(state: IntakeState, text: string): IntakeState {
  const turn: ConversationTurn = {
    turn_id: uuidv4(),
    speaker: 'ai',
    text,
    timestamp: new Date().toISOString(),
  };
  return { ...state, turns: [...state.turns, turn] };
}

// ─── Freeze ─────────────────────────────────────────────────────────────────

export function freezeIntake(state: IntakeState, schema: IntakeSchema): IntakeArtifact {
  return {
    artifact_id: uuidv4(),
    schema_id: state.schema_id,
    tenant_id: state.tenant_id,
    collected: { ...state.collected },
    missing_required_slots: getMissingRequiredSlots(schema, state.collected),
    turn_count: state.turns.length,
    frozen_at: new Date().toISOString(),
  };
}

export function toVerifyInput(artifact: IntakeArtifact): Record<string, unknown> {
  return { ...artifact.collected };
}
