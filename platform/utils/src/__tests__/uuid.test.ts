import { describe, it, expect } from 'vitest';
import { isValidUuid, parseUserId, AppError } from '../index';

describe('isValidUuid — the real, shared version, correcting the broken regex found in 2 live files', () => {
  it('accepts a genuine, real-shaped UUID (5 groups: 8-4-4-4-12)', () => {
    expect(isValidUuid('22222222-2222-2222-2222-222222222222')).toBe(true);
  });

  it('REJECTS a 4-group UUID (8-4-4-12) — this is the exact shape the broken regex in white-label/payments-advanced incorrectly required', () => {
    expect(isValidUuid('22222222-2222-2222-222222222222')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isValidUuid(12345)).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });
});

describe('parseUserId — the real, shared version', () => {
  it('returns a genuine UUID unchanged', () => {
    expect(parseUserId('22222222-2222-2222-2222-222222222222')).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('throws AppError for an invalid id, not a raw string error', () => {
    expect(() => parseUserId('not-a-uuid')).toThrow(AppError);
  });

  it('throws for a 4-group UUID — the exact bug that made white-label/payments-advanced reject every real user id', () => {
    expect(() => parseUserId('22222222-2222-2222-222222222222')).toThrow();
    expect(() => parseUserId('22222222-2222-2222-2222-222222222222')).not.toThrow();
  });
});
