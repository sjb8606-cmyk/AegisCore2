import { describe, it, expect } from 'vitest';
import { computeEventHash, GENESIS_HASH } from '../hash';

describe('GENESIS_HASH', () => {
  it('is 64 hex zero characters, matching sha256 hex length', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
    expect(GENESIS_HASH.length).toBe(64);
  });
});

describe('computeEventHash', () => {
  const lotId = '11111111-1111-1111-1111-111111111111';

  it('is deterministic for identical inputs', () => {
    const h1 = computeEventHash(lotId, 'created', { quantity: 100 }, GENESIS_HASH);
    const h2 = computeEventHash(lotId, 'created', { quantity: 100 }, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it('is insensitive to payload key order (sorted before hashing)', () => {
    const h1 = computeEventHash(lotId, 'created', { a: 1, b: 2 }, GENESIS_HASH);
    const h2 = computeEventHash(lotId, 'created', { b: 2, a: 1 }, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it('produces a different hash when the payload changes', () => {
    const h1 = computeEventHash(lotId, 'created', { quantity: 100 }, GENESIS_HASH);
    const h2 = computeEventHash(lotId, 'created', { quantity: 101 }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });

  it('produces a different hash when prevHash changes — this is the actual chaining property', () => {
    const h1 = computeEventHash(lotId, 'held', { reason: 'QC failure' }, GENESIS_HASH);
    const h2 = computeEventHash(lotId, 'held', { reason: 'QC failure' }, 'a'.repeat(64));
    expect(h1).not.toBe(h2);
  });

  it('produces a different hash for a different lotId with identical event/payload', () => {
    const otherLotId = '22222222-2222-2222-2222-222222222222';
    const h1 = computeEventHash(lotId, 'created', { quantity: 100 }, GENESIS_HASH);
    const h2 = computeEventHash(otherLotId, 'created', { quantity: 100 }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });

  it('always returns a 64-character hex string', () => {
    const h = computeEventHash(lotId, 'created', { quantity: 100 }, GENESIS_HASH);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
