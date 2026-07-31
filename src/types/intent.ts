/**
 * Veridact — Intent Classification Types
 *
 * Deterministic keyword-based intent classifier. Complements the Intake
 * Engine: where Intake fills predefined enum slots, Intent Classification
 * handles free-text utterances that don't map cleanly to a fixed slot list
 * (e.g. "I need to cancel my policy" when "cancellation" isn't an
 * enumerated topic option).
 *
 * Same determinism guarantee as the rest of Veridact: same text + same
 * schema always produces the same intent. No hidden inference.
 */

export interface IntentDefinition {
  intent_id: string;
  description: string;
  keywords: string[]; // case-insensitive substrings; any one match qualifies
  priority: number;   // lower number = evaluated first
}

export interface IntentSchema {
  schema_id: string;
  tenant_id: string;
  intents: IntentDefinition[];
  unknown_intent_id: string; // returned when no intent's keywords match
}

export interface IntentClassification {
  intent: string;
  matched_keywords: string[];
  evaluated_intents: string[]; // intent_ids checked, in order — for explainability
}
