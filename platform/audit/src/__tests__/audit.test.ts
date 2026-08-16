/**
 * platform/audit/src/__tests__/audit.test.ts
 *
 * Tests:
 * - Merkle chain linking and hash integrity
 * - Chain verification (detects tampering)
 * - Audit event schema validation
 * - Sequence ordering
 */

import { describe, test, expect } from 'vitest';
import { hashEvent, linkEvent, verifyChain, GENESIS_HASH, canonicalize } from '../merkle';
import { AuditEventSchema, AuditEventInputSchema } from '../schema';
import { randomUUID } from 'crypto';

// ── Helpers ───────────────────────────────────────────────────

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id:        randomUUID(),
    tenantId:  'tenant-test',
    actorId:   'user-123',
    actorType: 'user' as const,
    action:    'data.created' as const,
    outcome:   'success' as const,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MERKLE CHAIN TESTS
// ─────────────────────────────────────────────────────────────

describe('Merkle chain', () => {
  test('linkEvent sets _prevHash, _hash, and _sequence', () => {
    const event   = makeEvent();
    const chained = linkEvent(event, GENESIS_HASH, 0);

    expect(chained._prevHash).toBe(GENESIS_HASH);
    expect(chained._hash).toMatch(/^[0-9a-f]{64}$/);
    expect(chained._sequence).toBe(0);
  });

  test('hash is deterministic for same input', () => {
    const event = makeEvent({ id: 'fixed-uuid-1234-5678-9012-abcdef123456' });
    const hash1 = hashEvent(event);
    const hash2 = hashEvent(event);
    expect(hash1).toBe(hash2);
  });

  test('different events produce different hashes', () => {
    const e1 = makeEvent({ id: 'aaa-uuid-1234-5678-9012-abcdef123456' });
    const e2 = makeEvent({ id: 'bbb-uuid-1234-5678-9012-abcdef123456' });
    expect(hashEvent(e1)).not.toBe(hashEvent(e2));
  });

  test('chain of 3 events links correctly', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const chained = [];

    let prevHash = GENESIS_HASH;
    for (let i = 0; i < events.length; i++) {
      const c = linkEvent(events[i], prevHash, i);
      chained.push(c);
      prevHash = c._hash;
    }

    expect(chained[0]._prevHash).toBe(GENESIS_HASH);
    expect(chained[1]._prevHash).toBe(chained[0]._hash);
    expect(chained[2]._prevHash).toBe(chained[1]._hash);
  });

  test('verifyChain passes on valid chain', () => {
    const events = [];
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < 5; i++) {
      const c = linkEvent(makeEvent(), prevHash, i);
      events.push(c);
      prevHash = c._hash;
    }

    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checked).toBe(5);
  });

  test('verifyChain detects tampered event content', () => {
    const events = [];
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < 3; i++) {
      const c = linkEvent(makeEvent(), prevHash, i);
      events.push(c);
      prevHash = c._hash;
    }

    events[1] = { ...events[1], outcome: 'failure' as const };

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tampered'))).toBe(true);
  });

  test('verifyChain detects inserted event (sequence gap)', () => {
    const events = [];
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < 3; i++) {
      const c = linkEvent(makeEvent(), prevHash, i);
      events.push(c);
      prevHash = c._hash;
    }

    events.splice(1, 1);

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sequence gap'))).toBe(true);
  });

  test('verifyChain passes on empty array', () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// CANONICAL JSON TESTS
// ─────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  test('produces sorted keys', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const canon = canonicalize(obj);
    expect(canon).toBe('{"a":2,"m":3,"z":1}');
  });

  test('is stable regardless of insertion order', () => {
    const o1 = canonicalize({ b: 2, a: 1 });
    const o2 = canonicalize({ a: 1, b: 2 });
    expect(o1).toBe(o2);
  });
});

// ─────────────────────────────────────────────────────────────
// SCHEMA VALIDATION TESTS
// ─────────────────────────────────────────────────────────────

describe('AuditEvent schema', () => {
  test('validates a complete valid event', () => {
    const event = makeEvent();
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  test('rejects missing required fields', () => {
    const result = AuditEventSchema.safeParse({ id: randomUUID() });
    expect(result.success).toBe(false);
  });

  test('rejects invalid action', () => {
    const event = makeEvent({ action: 'invalid.action' });
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  test('rejects invalid outcome', () => {
    const event = makeEvent({ outcome: 'maybe' });
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  test('rejects non-datetime timestamp', () => {
    const event = makeEvent({ timestamp: 'not-a-date' });
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});
