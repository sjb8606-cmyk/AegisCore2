/**
 * apps/example-api/src/routes/blockchain-verify.ts
 * Blockchain Verify — content-hash verification records.
 *
 * NOTE: computes a real SHA-256 hash of the submitted content server-side
 * (never trusts a client-supplied hash) — same "don't trust the caller
 * for anything security/integrity relevant" principle used throughout
 * this whole build.
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

const CreateVerificationSchema = z.object({
  resourceRef: z.string().min(1).max(255),
  content:     z.string().min(1),
});

const VerificationIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; resource_ref: string; content_hash: string; chain: string; tx_ref: string | null; verified_at: string | null; created_at: string }>(
        `SELECT id, resource_ref, content_hash, chain, tx_ref, verified_at, created_at FROM blockchain_verifications
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'blockchain_verification', description: `Listed verification records (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateVerificationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateVerificationSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const contentHash = crypto.createHash('sha256').update(input.content).digest('hex');

      const rows = await withTenantQuery<{ id: string; resource_ref: string; content_hash: string; chain: string; tx_ref: string | null; verified_at: string | null; created_at: string }>(
        `INSERT INTO blockchain_verifications (tenant_id, user_id, resource_ref, content_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, resource_ref, content_hash, chain, tx_ref, verified_at, created_at`,
        [tenantId, userId, input.resourceRef, contentHash],
        tenantId,
      );

      const verification = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'blockchain_verification', resourceId: verification.id, description: `Recorded content hash for ${input.resourceRef}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${verification.id}` });

      return created(res, verification);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = VerificationIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM blockchain_verifications WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Verification record not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'blockchain_verification', resourceId: id, description: `Removed verification record ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as blockchainVerifyRouter };
