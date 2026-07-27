/**
 * Veridact — Intake Engine Types
 *
 * The Intake Engine turns an unstructured conversation into a structured,
 * immutable IntakeArtifact — the canonical input record that everything
 * downstream (Policy Evaluator, Coverage Boundary, Receipt Engine) consumes.
 *
 * A "slot" is one piece of information Veridact needs to collect before
 * intake can be considered complete (e.g. "topic", "account_id"). Slots are
 * defined per-tenant (what a clinic needs to collect differs from what a
 * bank needs), collected turn by turn, and the artifact is frozen once all
 * required slots are filled or the conversation ends.
 */

export type SlotType = 'string' | 'number' | 'boolean' | 'enum';

export interface SlotDefinition {
  slot_id: string;
  description: string;          // used to generate the follow-up question
  type: SlotType;
  required: boolean;
  enum_values?: string[];        // required if type === 'enum'
  prompt: string;                // the follow-up question asked if this slot is missing
}

export interface IntakeSchema {
  schema_id: string;
  tenant_id: string;
  slots: SlotDefinition[];
}

export type SlotValue = string | number | boolean;

export interface ConversationTurn {
  turn_id: string;
  speaker: 'customer' | 'ai';
  text: string;
  timestamp: string; // ISO 8601
}

export interface IntakeState {
  schema_id: string;
  tenant_id: string;
  collected: Record<string, SlotValue>;
  turns: ConversationTurn[];
  complete: boolean; // true once every required slot is filled
}

/**
 * The frozen, immutable output of a completed (or ended) intake session.
 * This is what gets normalized into a ContextEnvelope.input for /v1/verify.
 */
export interface IntakeArtifact {
  artifact_id: string;
  schema_id: string;
  tenant_id: string;
  collected: Record<string, SlotValue>;
  missing_required_slots: string[]; // non-empty if intake ended before completion
  turn_count: number;
  frozen_at: string; // ISO 8601
}

export interface IntakeStepResult {
  state: IntakeState;
  next_prompt: string | null; // null once complete — nothing left to ask
}
