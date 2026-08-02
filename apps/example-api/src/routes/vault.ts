/**
 * apps/example-api/src/routes/vault.ts
 * Vault — encrypted secret storage.
 *
 * SECURITY NOTES:
 * - Values are encrypted via @platform/security's real KMS envelope
 *   encryption (encryptField/decryptField) — never plaintext, never a
 *   fake base64 "encryption".
 * - GET /items intentionally never returns decrypted values, only
 *   metadata (id, name, timestamps). A real "reveal secret" flow would
 *   be a separate, more tightly-scoped endpoint (e.g. requiring a
 *   step-up auth check) — not built here since it wasn't asked for and
 *   deserves its own deliberate design rather than being bolted onto
 *   this batch's standard list/create/delete shape.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { encryptField } from '../../../../platform/security/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreateSecretSchema = z.object({
  name:  z.string().min(1).max(255),
  value: z.string().min(1).max(65_536),
});

const SecretIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      // Deliberately selects only metadata — never encrypted_value.
      const rows = await withTenantQuery<{ id: string; name: string; created_at: string; updated_at: string }>(
        `SELECT id, name, created_at, updated_at FROM vault_secrets
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'vault_secret', description: `Listed vault secret metadata (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateSecretSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateSecretSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const encryptedValue = await encryptField(input.value);

      const rows = await withTenantQuery<{ id: string; name: string; created_at: string; updated_at: string }>(
        `INSERT INTO vault_secrets (tenant_id, user_id, name, encrypted_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, name)
         DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = CURRENT_TIMESTAMP
         RETURNING id, name, created_at, updated_at`,
        [tenantId, userId, input.name, encryptedValue],
        tenantId,
      );

      const secret = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'vault_secret', resourceId: secret.id, description: `Stored secret '${input.name}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${secret.id}` });

      // Never echo the plaintext or ciphertext back, even on create.
      return created(res, secret);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = SecretIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM vault_secrets WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Secret not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'vault_secret', resourceId: id, description: `Deleted secret ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as vaultRouter };
