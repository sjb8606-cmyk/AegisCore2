/**
 * platform/utils/src/uuid.ts
 *
 * The real, shared UUID validator — extracted from 100 files that each
 * hand-wrote their own copy, in 6 slightly different variants. Two of
 * those live copies (platform/white-label, platform/payments-advanced)
 * had a genuinely broken regex missing one hyphen-separated group,
 * meaning parseUserId would throw "Invalid or missing user id" for
 * every real UUID passed to it — not just cosmetic duplication, a real
 * live bug. This is the correct version.
 */

import { AppError, ErrorCode } from './errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export function parseUserId(userId: unknown): string {
  if (isValidUuid(userId)) return userId as string;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}
