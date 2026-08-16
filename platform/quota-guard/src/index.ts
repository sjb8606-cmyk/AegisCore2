/**
 * platform/quota-guard/src/index.ts
 *
 * Confirmed identical, byte-for-byte, in 43 cores today:
 *   const countRes = await withTenantQuery('SELECT COUNT(*) ...', [tenantId], tenantId);
 *   if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.something) {
 *     throw new AppError('Monthly ... limit reached', ErrorCode.RATE_LIMITED);
 *   }
 *
 * Deliberately narrow scope, same principle as crud-kernel and hash-chain:
 * the SQL query itself genuinely varies (different tables, sometimes an
 * extra "AND deleted_at IS NULL" or "AND status = 'active'" condition) —
 * that stays in each core, un-templated, since forcing it through one
 * generic query builder would be the same leaky-abstraction mistake
 * flagged when crud-kernel was scoped. What's actually identical
 * everywhere is the comparison-and-throw logic AFTER the count comes
 * back — that's the part extracted here.
 */

import { AppError, ErrorCode } from '@platform/utils';

export { AppError, ErrorCode };

/**
 * Throws AppError(message, ErrorCode.RATE_LIMITED) if currentCount has
 * reached or exceeded limit. Accepts the count as either a number or the
 * raw string a Postgres COUNT(*) returns, so callers don't each
 * hand-write their own parseInt(...) — a real, if small, source of bugs
 * across the 43 duplicated instances (a wrong comparison operator or a
 * forgotten parseInt both silently break the quota check).
 */
export function enforceQuota(currentCount: number | string | undefined | null, limit: number, message: string): void {
  const count = typeof currentCount === 'string' ? parseInt(currentCount, 10) : (currentCount ?? 0);
  if (count >= limit) {
    throw new AppError(message, ErrorCode.RATE_LIMITED);
  }
}
