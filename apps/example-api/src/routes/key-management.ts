/**
 * apps/example-api/src/routes/key-management.ts
 * Key Management — issue/revoke API keys.
 *
 * SECURITY NOTES:
 * - Keys are generated via crypto.randomBytes, never Math.random().
 * - Only a salted scrypt hash is ever stored — same pattern used for
 *   MFA recovery codes elsewhere in this codebase. The plaintext key is
 *   returned exactly once, at creation time, and is never recoverable
 *   or shown again after that.
 * - GET /items never returns key_hash, only metadata + the key_prefix
 *   (a short, non-sensitive identifying prefix, common practice for
 *   letting a user recognize which key is which without exposing it).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreateKeySchema = z.object({
  name: z.string().min(1).max(255),
});

const KeyIdParamSchema = z.object({ id: z.string().uuid() });

function generateApiKey(): { plaintext: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const plaintext = `sk_${raw}`;
  const prefix = plaintext.slice(0, 11); // "sk_" + 8 chars, enough to recognize, not enough to brute-force
  return { plaintext, prefix };
}

function hashApiKey(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plaintext, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      // Deliberately selects only metadata + prefix — never key_hash.
      const rows = await withTenantQuery<{ id: string; name: string; key_prefix: string; last_used_at: string | null; created_at: string; revoked_at: string | null }>(
        `SELECT id, name, key_prefix, last_used_at, created_at, revoked_at FROM api_keys
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'api_key', description: `Listed API key metadata (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateKeySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateKeySchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const { plaintext, prefix } = generateApiKey();
      const keyHash = hashApiKey(plaintext);

      const rows = await withTenantQuery<{ id: string; name: string; key_prefix: string; created_at: string }>(
        `INSERT INTO api_keys (tenant_id, user_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, key_prefix, created_at`,
        [tenantId, userId, input.name, prefix, keyHash],
        tenantId,
      );

      const key = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'api_key', resourceId: key.id, description: `Issued API key '${input.name}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${key.id}` });

      // The only time the plaintext key is ever returned. Not stored
      // anywhere in recoverable form after this response.
      return created(res, { ...key, apiKey: plaintext });
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = KeyIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('API key not found or already revoked', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'api_key', resourceId: id, description: `Revoked API key ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as keyManagementRouter };
