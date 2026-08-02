/**
 * apps/example-api/src/routes/mentions.ts
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import type { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreateMentionSchema = z.object({
  mentionedUserId: z.string().uuid(),
  resourceType:    z.string().min(1).max(100),
  resourceId:      z.string().uuid(),
  contextSnippet:  z.string().max(2000).optional(),
});

const MentionIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; mentioned_by_user_id: string; resource_type: string; resource_id: string; context_snippet: string | null; created_at: string }>(
        `SELECT id, mentioned_by_user_id, resource_type, resource_id, context_snippet, created_at FROM mentions
         WHERE mentioned_user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'mention', description: `Listed mentions (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateMentionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateMentionSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; mentioned_by_user_id: string; resource_type: string; resource_id: string; context_snippet: string | null; created_at: string }>(
        `INSERT INTO mentions (tenant_id, mentioned_user_id, mentioned_by_user_id, resource_type, resource_id, context_snippet)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, mentioned_by_user_id, resource_type, resource_id, context_snippet, created_at`,
        [tenantId, input.mentionedUserId, userId, input.resourceType, input.resourceId, input.contextSnippet ?? null],
        tenantId,
      );

      const mention = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'mention', resourceId: mention.id, description: `Mentioned user ${input.mentionedUserId} on ${input.resourceType}:${input.resourceId}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${mention.id}` });

      return created(res, mention);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = MentionIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM mentions WHERE id = $1 AND mentioned_user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Mention not found or not yours to dismiss', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'mention', resourceId: id, description: `Dismissed mention ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as mentionsRouter };
