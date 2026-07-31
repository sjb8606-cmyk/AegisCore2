/**
 * Veridact v1.0 — Translator Layer
 */

import type { EventType } from '../types';

const TRANSLATIONS: Record<EventType, string> = {
  new_receipt: 'A new verified decision was recorded.',
  rule_change: 'System rules were modified.',
  manual_override: 'A decision was manually overridden.',
  system_update: 'A system-level change was recorded.',
  replay_match: 'Decision replayed successfully. Result unchanged.',
  replay_mismatch: 'Replayed decision does not match original. Investigation required.',
  hash_mismatch: 'A previous decision no longer matches current rules.',
};

export function translate(eventType: EventType): string {
  const msg = TRANSLATIONS[eventType];
  if (!msg) {
    throw new Error(`Unknown event_type for translation: ${String(eventType)}`);
  }
  return msg;
}

export function translateSafe(eventType: string): string {
  return TRANSLATIONS[eventType as EventType] ?? `Unknown event type: ${eventType}`;
}

export { TRANSLATIONS };
