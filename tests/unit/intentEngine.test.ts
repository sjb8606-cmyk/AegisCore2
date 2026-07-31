/**
 * Veridact — Unit Tests: Intent Classification Engine
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent, attachIntent } from '../../src/engines/intentEngine';
import type { IntentSchema } from '../../src/types/intent';

const schema: IntentSchema = {
  schema_id: 'clinic-intent-v1',
  tenant_id: 'tenant-1',
  unknown_intent_id: 'unknown',
  intents: [
    {
      intent_id: 'cancellation',
      description: 'Caller wants to cancel a policy or appointment',
      keywords: ['cancel', 'cancellation', 'stop my'],
      priority: 1,
    },
    {
      intent_id: 'billing_inquiry',
      description: 'Caller has a question about a charge or invoice',
      keywords: ['bill', 'invoice', 'charge', 'payment'],
      priority: 2,
    },
    {
      intent_id: 'medical_question',
      description: 'Caller is asking a medical question',
      keywords: ['symptom', 'medication', 'dosage', 'pain'],
      priority: 3,
    },
  ],
};

describe('classifyIntent', () => {
  it('classifies a clear cancellation request', () => {
    const result = classifyIntent('I need to cancel my policy please', schema);
    expect(result.intent).toBe('cancellation');
    expect(result.matched_keywords).toContain('cancel');
  });

  it('classifies a billing question', () => {
    const result = classifyIntent('why was I charged twice this month', schema);
    expect(result.intent).toBe('billing_inquiry');
  });

  it('classifies a medical question', () => {
    const result = classifyIntent('what is the correct dosage for this medication', schema);
    expect(result.intent).toBe('medical_question');
  });

  it('returns the unknown intent when nothing matches', () => {
    const result = classifyIntent('what time do you open on weekends', schema);
    expect(result.intent).toBe('unknown');
    expect(result.matched_keywords).toEqual([]);
  });

  it('respects priority order when multiple intents could match', () => {
    const result = classifyIntent('I want to cancel my payment plan', schema);
    expect(result.intent).toBe('cancellation');
    expect(result.evaluated_intents[0]).toBe('cancellation');
  });

  it('is case-insensitive', () => {
    const result = classifyIntent('CAN YOU CANCEL THIS', schema);
    expect(result.intent).toBe('cancellation');
  });

  it('evaluated_intents records every intent checked before a match', () => {
    const result = classifyIntent('question about my invoice', schema);
    expect(result.evaluated_intents).toEqual(['cancellation', 'billing_inquiry']);
  });
});

describe('attachIntent', () => {
  it('merges the classified intent into an existing input object', () => {
    const classification = classifyIntent('cancel my appointment', schema);
    const input = attachIntent({ caller_id: 'C-1' }, classification);
    expect(input).toEqual({ caller_id: 'C-1', intent: 'cancellation' });
  });

  it('does not mutate the original input object', () => {
    const original = { caller_id: 'C-1' };
    const classification = classifyIntent('cancel my appointment', schema);
    attachIntent(original, classification);
    expect(original).toEqual({ caller_id: 'C-1' }); // unchanged
  });
});
