import { describe, it, expect } from 'vitest';
import { computeChainHash, verifyChain, GENESIS_HASH } from '../index';

const SCOPE = '11111111-1111-1111-1111-111111111111';

describe('GENESIS_HASH', () => {
  it('is 64 hex zero characters', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });
});

describe('computeChainHash', () => {
  it('is deterministic for identical inputs', () => {
    const h1 = computeChainHash(SCOPE, 'created', { quantity: 100 }, GENESIS_HASH);
    const h2 = computeChainHash(SCOPE, 'created', { quantity: 100 }, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it('is insensitive to payload key order', () => {
    const h1 = computeChainHash(SCOPE, 'created', { a: 1, b: 2 }, GENESIS_HASH);
    const h2 = computeChainHash(SCOPE, 'created', { b: 2, a: 1 }, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it('changes when the previous hash changes — this is the actual chaining property', () => {
    const h1 = computeChainHash(SCOPE, 'held', { reason: 'QC' }, GENESIS_HASH);
    const h2 = computeChainHash(SCOPE, 'held', { reason: 'QC' }, 'a'.repeat(64));
    expect(h1).not.toBe(h2);
  });

  it('changes when the payload changes', () => {
    const h1 = computeChainHash(SCOPE, 'created', { quantity: 100 }, GENESIS_HASH);
    const h2 = computeChainHash(SCOPE, 'created', { quantity: 101 }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });

  it('always returns a 64-character hex string', () => {
    const h = computeChainHash(SCOPE, 'created', { quantity: 100 }, GENESIS_HASH);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyChain', () => {
  it('returns null (valid) for an empty chain', () => {
    expect(verifyChain([])).toBeNull();
  });

  it('returns null for a real, correctly-built chain', () => {
    const e1Hash = computeChainHash(SCOPE, 'created', { qty: 100 }, GENESIS_HASH);
    const e2Hash = computeChainHash(SCOPE, 'held', { reason: 'QC' }, e1Hash);
    const e3Hash = computeChainHash(SCOPE, 'released', {}, e2Hash);

    const chain = [
      { scopeId: SCOPE, eventType: 'created', payload: { qty: 100 }, previousHash: GENESIS_HASH, hash: e1Hash },
      { scopeId: SCOPE, eventType: 'held', payload: { reason: 'QC' }, previousHash: e1Hash, hash: e2Hash },
      { scopeId: SCOPE, eventType: 'released', payload: {}, previousHash: e2Hash, hash: e3Hash },
    ];

    expect(verifyChain(chain)).toBeNull();
  });

  it('catches a tampered payload — the hash no longer matches its own recomputation', () => {
    const e1Hash = computeChainHash(SCOPE, 'created', { qty: 100 }, GENESIS_HASH);

    const chain = [
      { scopeId: SCOPE, eventType: 'created', payload: { qty: 99999 }, previousHash: GENESIS_HASH, hash: e1Hash },
    ];

    const result = verifyChain(chain);
    expect(result).not.toBeNull();
    expect(result?.reason).toBe('hash_mismatch');
    expect(result?.index).toBe(0);
  });

  it('catches a deleted/reordered event — the chain link itself is broken', () => {
    const e1Hash = computeChainHash(SCOPE, 'created', { qty: 100 }, GENESIS_HASH);
    const e2Hash = computeChainHash(SCOPE, 'held', { reason: 'QC' }, e1Hash);
    const e3Hash = computeChainHash(SCOPE, 'released', {}, e2Hash);

    const tamperedChain = [
      { scopeId: SCOPE, eventType: 'created', payload: { qty: 100 }, previousHash: GENESIS_HASH, hash: e1Hash },
      { scopeId: SCOPE, eventType: 'released', payload: {}, previousHash: e2Hash, hash: e3Hash },
    ];

    const result = verifyChain(tamperedChain);
    expect(result).not.toBeNull();
    expect(result?.reason).toBe('previous_hash_mismatch');
    expect(result?.index).toBe(1);
  });

  it('requires the first event to chain from GENESIS_HASH, not an arbitrary starting point', () => {
    const fakeHash = computeChainHash(SCOPE, 'created', { qty: 100 }, 'f'.repeat(64));

    const chain = [
      { scopeId: SCOPE, eventType: 'created', payload: { qty: 100 }, previousHash: 'f'.repeat(64), hash: fakeHash },
    ];

    const result = verifyChain(chain);
    expect(result).not.toBeNull();
    expect(result?.reason).toBe('previous_hash_mismatch');
    expect(result?.expected).toBe(GENESIS_HASH);
  });
});
