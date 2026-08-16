/**
 * platform/hash-chain/src/index.ts
 *
 * The actual cryptographic core of every tamper-evident event log in this
 * repo — compute a hash, chain it to the previous event's hash, verify
 * the chain later. Modeled directly on Veridact's real, original pattern
 * (src/engines/receiptEngine.ts's computeReceiptHash), the most mature of
 * what were, before this, four independently-reimplemented versions of
 * the same algorithm: Veridact, platform/audit, platform/audit-log, and
 * platform/lot-traceability.
 *
 * Deliberately narrow scope: this does NOT try to absorb Veridact's
 * policy-bundle evaluation, decision computation, or idempotency-key
 * logic — those are genuinely Veridact-specific, not part of the shared
 * hash-chain concept. What's shared here is only the part that's
 * identical no matter what's being chained: a lot's events, a receipt's
 * decisions, or a generic audit log's entries.
 *
 * Rollout note: existing consumers (Veridact, platform/audit,
 * platform/audit-log, platform/lot-traceability) have NOT been migrated
 * to this yet — that's a deliberate, separate decision, same as
 * @platform/crud-kernel. This is the primitive, ready when the rollout
 * happens.
 */

import * as crypto from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export function computeChainHash(
  scopeId: string,
  eventType: string,
  payload: Record<string, unknown>,
  previousHash: string,
): string {
  const sortedPayload = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  return crypto
    .createHash('sha256')
    .update(`${scopeId}:${eventType}:${sortedPayload}:${previousHash}`)
    .digest('hex');
}

export interface ChainEvent {
  scopeId: string;
  eventType: string;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface ChainBreak {
  index: number;
  reason: 'hash_mismatch' | 'previous_hash_mismatch';
  expected: string;
  actual: string;
}

export function verifyChain(events: ChainEvent[]): ChainBreak | null {
  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.previousHash !== expectedPrevHash) {
      return {
        index: i,
        reason: 'previous_hash_mismatch',
        expected: expectedPrevHash,
        actual: event.previousHash,
      };
    }

    const recomputed = computeChainHash(event.scopeId, event.eventType, event.payload, event.previousHash);
    if (recomputed !== event.hash) {
      return {
        index: i,
        reason: 'hash_mismatch',
        expected: recomputed,
        actual: event.hash,
      };
    }

    expectedPrevHash = event.hash;
  }

  return null;
}
