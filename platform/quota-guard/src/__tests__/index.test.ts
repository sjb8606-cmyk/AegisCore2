import { describe, it, expect } from 'vitest';
import { enforceQuota, ErrorCode } from '../index';

describe('enforceQuota', () => {
  it('does not throw when count is under the limit', () => {
    expect(() => enforceQuota(5, 10, 'limit reached')).not.toThrow();
  });

  it('throws at the boundary — count equal to limit is already "reached", matching the real >= comparison used everywhere', () => {
    expect(() => enforceQuota(10, 10, 'Contact limit reached for this tier')).toThrow('Contact limit reached for this tier');
  });

  it('throws when count exceeds the limit', () => {
    expect(() => enforceQuota(15, 10, 'limit reached')).toThrow();
  });

  it('throws AppError with ErrorCode.RATE_LIMITED specifically, matching all 43 real call sites', () => {
    try {
      enforceQuota(10, 10, 'limit reached');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.RATE_LIMITED);
    }
  });

  it('handles a string count, exactly what a real Postgres COUNT(*) query returns', () => {
    expect(() => enforceQuota('10', 10, 'limit reached')).toThrow();
    expect(() => enforceQuota('9', 10, 'limit reached')).not.toThrow();
  });

  it('handles the real "0" string fallback pattern (countRes[0]?.count || \'0\') used at every one of the 43 sites', () => {
    expect(() => enforceQuota('0', 1, 'limit reached')).not.toThrow();
  });

  it('treats undefined/null count as 0, not a crash — an empty result set edge case', () => {
    expect(() => enforceQuota(undefined, 1, 'limit reached')).not.toThrow();
    expect(() => enforceQuota(null, 1, 'limit reached')).not.toThrow();
  });

  it('carries the real, specific message through — each of the 43 sites has a different one', () => {
    try {
      enforceQuota(5, 5, 'Monthly document processing limits reached');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toBe('Monthly document processing limits reached');
    }
  });
});
