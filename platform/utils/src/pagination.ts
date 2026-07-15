/**
 * platform/utils/src/pagination.ts
 *
 * Cursor-based pagination helpers.
 * Cursor-based preferred over offset for large datasets (no drift on inserts).
 * Also supports ETag-based caching for list endpoints.
 */

import { createHash } from 'crypto';
import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────

export const PaginationQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  sort:   z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ── Types ──────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data:       T[];
  pagination: {
    limit:      number;
    hasMore:    boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    total?:     number; // optional — expensive to compute for large tables
  };
}

// ── Cursor encoding ────────────────────────────────────────────

export function encodeCursor(value: string | number | Date): string {
  const raw = String(value instanceof Date ? value.toISOString() : value);
  return Buffer.from(raw).toString('base64url');
}

export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

// ── Page builder ───────────────────────────────────────────────

/**
 * buildPage — given a raw DB result (limit+1 items), build paginated response.
 *
 * Fetch limit+1 records; if you get limit+1 results, there are more pages.
 */
export function buildPage<T extends Record<string, unknown>>(
  items:      T[],
  cursorField: keyof T,
  query:      PaginationQuery,
): PaginatedResponse<T> {
  const hasMore = items.length > query.limit;
  const data    = hasMore ? items.slice(0, query.limit) : items;

  const nextCursor = hasMore
    ? encodeCursor(data[data.length - 1][cursorField] as string)
    : null;

  const prevCursor = query.cursor ? encodeCursor(data[0]?.[cursorField] as string) : null;

  return {
    data,
    pagination: {
      limit:      query.limit,
      hasMore,
      nextCursor,
      prevCursor,
    },
  };
}

// ── ETag helpers ───────────────────────────────────────────────

/**
 * computeETag — derive a strong ETag from response data.
 * Use for list endpoints to enable conditional GET (304 Not Modified).
 */
export function computeETag(data: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 32);
  return `"${hash}"`;
}

import { Request, Response } from 'express';

/**
 * handleETag — set ETag header and return 304 if client cache is valid.
 * Returns true if 304 was sent (caller should return early).
 */
export function handleETag(req: Request, res: Response, data: unknown): boolean {
  const etag = computeETag(data);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, must-revalidate');

  const clientEtag = req.headers['if-none-match'];
  if (clientEtag === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}
