/**
 * Veridact — Intent Classification Engine
 *
 * Classifies free-text utterances into a fixed set of tenant-defined intents.
 * Intents are checked in ascending priority order; the first intent with a
 * matching keyword wins. If nothing matches, schema.unknown_intent_id is
 * returned — fail-closed in spirit: an unrecognized request is flagged as
 * unknown rather than silently guessed at.
 */

import type { IntentClassification, IntentSchema } from '../types/intent';

function textContainsAnyKeyword(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

export function classifyIntent(text: string, schema: IntentSchema): IntentClassification {
  const sortedIntents = [...schema.intents].sort((a, b) => a.priority - b.priority);
  const evaluatedIntents: string[] = [];

  for (const intent of sortedIntents) {
    evaluatedIntents.push(intent.intent_id);
    const matches = textContainsAnyKeyword(text, intent.keywords);
    if (matches.length > 0) {
      return {
        intent: intent.intent_id,
        matched_keywords: matches,
        evaluated_intents: evaluatedIntents,
      };
    }
  }

  return {
    intent: schema.unknown_intent_id,
    matched_keywords: [],
    evaluated_intents: evaluatedIntents,
  };
}

/**
 * Merge a classified intent into a verify input object, under the "intent"
 * field — this is what the Policy Rule Evaluator's conditions can then
 * check against (e.g. { field: 'intent', operator: 'eq', value: 'cancellation' }).
 */
export function attachIntent(
  input: Record<string, unknown>,
  classification: IntentClassification
): Record<string, unknown> {
  return { ...input, intent: classification.intent };
}
