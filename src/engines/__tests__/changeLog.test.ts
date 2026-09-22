import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../db/client', () => ({
  withTenant: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }),
  ),
}));

import { hashState, buildDiff, writeChangeEntry } from '../changeLog';

describe('changeLog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashState is deterministic and order-independent for same keys', () => {
    const a = hashState({ b: 2, a: 1 });
    const b = hashState({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashState changes when value changes', () => {
    expect(hashState({ x: 1 })).not.toBe(hashState({ x: 2 }));
  });

  it('buildDiff reports added, removed, and changed fields', () => {
    const diff = buildDiff({ a: 1, b: 2 }, { b: 3, c: 4 });
    const fields = diff.map((d) => d.field).sort();
    expect(fields).toEqual(['a', 'b', 'c']);
    expect(diff.find((d) => d.field === 'b')).toEqual({ field: 'b', before: 2, after: 3 });
  });

  it('buildDiff returns empty when equal', () => {
    expect(buildDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('writeChangeEntry inserts and returns entry', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as any;
    const entry = await writeChangeEntry({
      tenantId: '11111111-1111-1111-1111-111111111111',
      eventType: 'rule_change',
      actor: { type: 'user', id: 'u1' },
      actionType: 'rules.updated',
      previousStateHash: '0'.repeat(64),
      newStateHash: 'a'.repeat(64),
      diff: [{ field: 'limit', before: 1, after: 2 }],
      client,
    });
    expect(entry.event_type).toBe('rule_change');
    expect(entry.action_type).toBe('rules.updated');
    expect(query).toHaveBeenCalled();
  });
});
