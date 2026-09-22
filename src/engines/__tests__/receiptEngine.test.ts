import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../db/client', () => ({
  withTenant: vi.fn(),
}));
vi.mock('../changeLog', () => ({
  writeChangeEntry: vi.fn(),
  buildDiff: vi.fn(),
  hashState: vi.fn(),
}));
vi.mock('../alertEngine', () => ({
  triggerAlert: vi.fn(),
}));
vi.mock('../policyEngine', () => ({
  evaluatePolicy: vi.fn(() => ({
    decision: 'allow',
    requires_hitl: false,
    matched_rule_id: 'r1',
    reason: 'ok',
    evaluated_rules: 1,
  })),
}));
vi.mock('../policyBundleStore', () => ({
  getPolicyBundle: vi.fn(async () => ({
    version: '1.0.0',
    hash: 'b'.repeat(64),
    rules: [],
  })),
}));

import { recomputeHash } from '../receiptEngine';
import type { Receipt } from '../../types';

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    receipt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    event_type: 'new_receipt',
    input: { amount: 100, region: 'NB' },
    output: { decision: 'allow' },
    rules_version: '1.0.0',
    rules_hash: 'b'.repeat(64),
    hash: '',
    previous_hash: '0'.repeat(64),
    timestamp: new Date().toISOString(),
    replayable: true,
    actor: { type: 'user', id: 'u1' },
    context: { source: 'api', trigger: 'manual' },
    ...overrides,
  };
}

describe('receiptEngine', () => {
  it('recomputeHash is deterministic for same receipt fields', () => {
    const r = makeReceipt();
    const h1 = recomputeHash(r);
    const h2 = recomputeHash(r);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recomputeHash changes when input changes', () => {
    const a = recomputeHash(makeReceipt({ input: { amount: 1 } }));
    const b = recomputeHash(makeReceipt({ input: { amount: 2 } }));
    expect(a).not.toBe(b);
  });

  it('recomputeHash changes when previous_hash changes (chain link)', () => {
    const a = recomputeHash(makeReceipt({ previous_hash: '0'.repeat(64) }));
    const b = recomputeHash(makeReceipt({ previous_hash: 'c'.repeat(64) }));
    expect(a).not.toBe(b);
  });

  it('recomputeHash is stable under input key order', () => {
    const a = recomputeHash(makeReceipt({ input: { z: 1, a: 2 } }));
    const b = recomputeHash(makeReceipt({ input: { a: 2, z: 1 } }));
    expect(a).toBe(b);
  });
});
