/**
 * platform/auth/src/replay-protection.ts
 *
 * jti (JWT ID) replay protection using Redis SET with NX + TTL.
 * A token whose jti has been seen is immediately rejected.
 *
 * Strategy:
 *   - On first use: SET jti:seen:<jti> 1 NX EX <ttl> → OK   (novel)
 *   - On repeat:    SET ... NX EX ... → null               (replayed)
 *
 * TTL is taken from the token's own exp claim when available,
 * falling back to env REDIS_JTI_TTL (default 3600 seconds).
 */

import Redis from 'ioredis';
import { getLogger } from '@platform/observability';
import { getRedis } from './redis-client';

const logger = getLogger('auth:replay');

const DEFAULT_TTL_SECONDS = parseInt(process.env.REDIS_JTI_TTL || '3600', 10);
const JTI_PREFIX = (process.env.REDIS_KEY_PREFIX || 'platform:') + 'jti:seen:';

/**
 * Returns true if the jti has already been used (replay detected).
 * Returns false on first use and records the jti atomically.
 */
export async function checkReplay(jti: string): Promise<boolean> {
  const client = getRedis();
  const key    = JTI_PREFIX + sanitizeJti(jti);
  const ttl    = DEFAULT_TTL_SECONDS;

  // SET key 1 NX EX ttl — atomic; returns 'OK' on first use, null on replay
  const result = await client.set(key, '1', 'EX', ttl, 'NX');
  return result === null; // null → key already existed → replay
}

/**
 * Explicitly mark a jti as used (call after checkReplay returns false).
 * If ttlSeconds is provided it overrides the default.
 */
export async function markJti(jti: string, ttlSeconds?: number): Promise<void> {
  // Note: checkReplay already sets the key atomically in one round-trip.
  // markJti is a no-op in the default flow but available for custom workflows
  // where checkReplay and markJti need to be decoupled (e.g. after business validation).
  const client = getRedis();
  const key    = JTI_PREFIX + sanitizeJti(jti);
  const ttl    = ttlSeconds ?? DEFAULT_TTL_SECONDS;

  if (ttl <= 0) {
    logger.warn({ jti }, 'Token already expired; skipping jti marking');
    return;
  }

  await client.set(key, '1', 'EX', ttl);
}

/**
 * Remove a jti from the seen set (use for token revocation tests / admin ops).
 */
export async function revokeJti(jti: string): Promise<void> {
  const client = getRedis();
  await client.del(JTI_PREFIX + sanitizeJti(jti));
  logger.info({ jti }, 'jti revoked from replay store');
}

/**
 * Check whether a jti exists in the seen set (read-only, no mutation).
 */
export async function jtiExists(jti: string): Promise<boolean> {
  const client = getRedis();
  const result = await client.exists(JTI_PREFIX + sanitizeJti(jti));
  return result === 1;
}

// ── Helpers ───────────────────────────────────────────────────

/** Strip chars that could cause Redis key injection */
function sanitizeJti(jti: string): string {
  if (!jti || typeof jti !== 'string') {
    throw new Error('Invalid jti: must be a non-empty string');
  }
  // Reject (not strip) any disallowed character - stripping would let
  // malicious input like '../../etc/passwd' slip through as '......etcpasswd'
  if (!/^[a-zA-Z0-9\-_.]+$/.test(jti)) {
    throw new Error('Invalid jti: contains disallowed characters');
  }
  if (jti.length < 8) {
    throw new Error('Invalid jti: too short');
  }
  return jti;
}
