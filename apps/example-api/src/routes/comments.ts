/**
 * apps/example-api/src/routes/comments.ts
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

const ListCommentsQuerySchema = PaginationQuerySchema.extend({
  resourceType: z.string().min(1).max(100),
  resourceId:   z.string().uuid(),
});

const CreateCommentSchema = z.object({
  resourceType: z.string().min(1).max(100),
  resourceId:   z.string().uuid(),
  body:         z.string().min(1).max(10_000),
});

const CommentIdParamSchema = z.object({
  id: z.string().uuid(),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListCommentsQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; user_id: string; body: string; created_at: string; updated_at: string }>(
        `SELECT id, user_id, body, created_at, updated_at FROM comments
         WHERE resource_type = $1 AND resource_id = $2 AND deleted_at IS NULL
           AND ($3::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $3::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $4`,
        [query.resourceType, query.resourceId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);

      if (handleETag(req, res, page)) return;

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.read',
        outcome:    'success',
        resource:   'comment',
        description: `Listed comments for ${query.resourceType}:${query.resourceId} (page cursor: ${query.cursor || 'start'})`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${Date.now()}`,
      });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateCommentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateCommentSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; user_id: string; body: string; created_at: string; updated_at: string }>(
        `INSERT INTO comments (tenant_id, user_id, resource_type, resource_id, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, body, created_at, updated_at`,
        [tenantId, userId, input.resourceType, input.resourceId, input.body],
        tenantId,
      );

      const comment = rows[0];

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.created',
        outcome:    'success',
        resource:   'comment',
        resourceId: comment.id,
        description: `Commented on ${input.resourceType}:${input.resourceId}`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${comment.id}`,
      });

      return created(res, comment);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = CommentIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE comments SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Comment not found, already deleted, or not owned by you', ErrorCode.NOT_FOUND));
      }

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.deleted',
        outcome:    'success',
        resource:   'comment',
        resourceId: id,
        description: `Deleted comment ${id}`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${Date.now()}`,
      });

      return ok(res, { id });
    } catch (err) {
      next(err);
    }
  }
);

export { router as commentsRouter };
