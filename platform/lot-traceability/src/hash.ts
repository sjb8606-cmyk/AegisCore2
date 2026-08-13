import * as crypto from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Computes a hash-chained fingerprint for a lot event, in the same spirit
 * as Veridact's receipt hash chain (src/engines/receiptEngine.ts): each
 * event's hash incorporates the previous event's hash, so a lot's full
 * history is tamper-evident, not just stored. If any past event's payload
 * were altered, every hash after it would fail to recompute — the same
 * replay-verification idea Veridact already uses, applied to lot events
 * instead of AI-decision receipts.
 */
export function computeEventHash(
  lotId: string,
  eventType: string,
  payload: Record<string, unknown>,
  prevHash: string,
): string {
  const sortedPayload = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  return crypto
    .createHash('sha256')
    .update(`${lotId}:${eventType}:${sortedPayload}:${prevHash}`)
    .digest('hex');
}
