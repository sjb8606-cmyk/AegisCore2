/**
 * @platform/diff-engine
 * Canonical sorted-key hashing + field-level from/to diff.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN' },
}));
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

import { storeDiff, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

describe('diff-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({ enabled: true, limits: { maxDepth: 5 } });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, limits: { maxDepth: 5 } });
    await expect(storeDiff(TENANT, {
      entity_type: 'order', entity_id: 'o1', before: {}, after: { a: 1 }, actor_id: ACTOR,
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('computes changedFields and persists diff', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]);
    const result = await storeDiff(TENANT, {
      entity_type: 'order',
      entity_id: 'o1',
      before: { status: 'open', total: 10 },
      after: { status: 'paid', total: 10, note: 'ok' },
      actor_id: ACTOR,
    });
    expect(result.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(result.changedFields.sort()).toEqual(['note', 'status'].sort());
    const args = mockWithTenantQuery.mock.calls[0][1];
    const payload = JSON.parse(args[3]);
    expect(payload.status).toEqual({ from: 'open', to: 'paid' });
    expect(payload.note).toEqual({ from: undefined, to: 'ok' });
    expect(args[4]).toMatch(/^[a-f0-9]{64}$/); // before_hash
    expect(args[5]).toMatch(/^[a-f0-9]{64}$/); // after_hash
  });

  it('returns empty changedFields when before === after', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }]);
    const result = await storeDiff(TENANT, {
      entity_type: 'doc', entity_id: 'd1',
      before: { a: 1 }, after: { a: 1 }, actor_id: ACTOR,
    });
    expect(result.changedFields).toEqual([]);
  });
});
