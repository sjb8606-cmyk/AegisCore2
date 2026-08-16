import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';

export { GENESIS_HASH };

/**
 * This used to be a standalone sha256 implementation — one of 4
 * independent reimplementations of the same algorithm across the repo
 * (Veridact, platform/audit, platform/audit-log, and this file). It was
 * actually the pattern @platform/hash-chain was modeled on in the first
 * place, so this delegation changes ZERO hash values: computeChainHash's
 * algorithm is byte-for-byte identical to what was here before (same
 * sorted-payload approach, same input format), just with a generic
 * `scopeId` parameter name instead of `lotId`. Every existing hash
 * already stored in a real database remains valid and verifiable.
 */
export function computeEventHash(
  lotId: string,
  eventType: string,
  payload: Record<string, unknown>,
  prevHash: string,
): string {
  return computeChainHash(lotId, eventType, payload, prevHash);
}
