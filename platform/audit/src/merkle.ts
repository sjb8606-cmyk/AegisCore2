/**
 * platform/audit/src/merkle.ts
 *
 * Merkle-chain linking of audit events.
 *
 * Each event stores:
 *   _prevHash: SHA-256 of the previous event's canonical JSON
 *   _hash:     SHA-256 of this event's canonical JSON (including _prevHash)
 *
 * This creates a tamper-evident chain: modifying any event
 * invalidates all subsequent hashes.
 *
 * Verification: re-compute each hash and compare chain linkage.
 */

import { createHash } from 'crypto';
import { AuditEvent } from './schema';

// ── Genesis hash (first event in chain) ───────────────────────

export const GENESIS_HASH = '0'.repeat(64); // 64 zero chars

// ── Hash computation ──────────────────────────────────────────

/**
 * Compute deterministic SHA-256 of an audit event.
 * Fields must be sorted to ensure canonical JSON.
 */
export function hashEvent(event: Omit<AuditEvent, '_hash'>): string {
  const canonical = canonicalize(event);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Produce canonical (sorted-key) JSON of an object.
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj))           return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as object).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

// ── Chain builder ─────────────────────────────────────────────

export interface ChainedEvent extends AuditEvent {
  _prevHash: string;
  _hash:     string;
  _sequence: number;
}

/**
 * Link an event into the chain.
 * Returns the event with _prevHash, _hash, and _sequence set.
 */
export function linkEvent(
  event: AuditEvent,
  previousHash: string,
  sequence: number
): ChainedEvent {
  const eventWithPrev: Omit<AuditEvent, '_hash'> = {
    ...event,
    _prevHash: previousHash,
    _sequence: sequence,
  };

  const hash = hashEvent(eventWithPrev);

  return {
    ...eventWithPrev,
    _hash: hash,
  } as ChainedEvent;
}

// ── Chain verification ────────────────────────────────────────

export interface VerificationResult {
  valid:    boolean;
  errors:   string[];
  checked:  number;
}

/**
 * Verify the integrity of an ordered array of chained audit events.
 * Returns a verification result with any chain breaks identified.
 */
export function verifyChain(events: ChainedEvent[]): VerificationResult {
  const errors: string[] = [];

  if (events.length === 0) {
    return { valid: true, errors: [], checked: 0 };
  }

  let previousHash = GENESIS_HASH;
  let previousSeq  = -1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Check sequence is monotonically increasing
    if (event._sequence !== previousSeq + 1) {
      errors.push(
        `Event[${i}] id=${event.id}: sequence gap — expected ${previousSeq + 1}, got ${event._sequence}`
      );
    }

    // Check prevHash links correctly
    if (event._prevHash !== previousHash) {
      errors.push(
        `Event[${i}] id=${event.id}: _prevHash mismatch — ` +
        `expected ${previousHash.slice(0, 16)}…, got ${event._prevHash?.slice(0, 16)}…`
      );
    }

    // Re-compute hash
    const { _hash, ...withoutHash } = event;
    const computedHash = hashEvent(withoutHash as Omit<AuditEvent, '_hash'>);
    if (computedHash !== event._hash) {
      errors.push(
        `Event[${i}] id=${event.id}: _hash invalid — event content has been tampered`
      );
    }

    previousHash = event._hash;
    previousSeq  = event._sequence;
  }

  return {
    valid:   errors.length === 0,
    errors,
    checked: events.length,
  };
}
