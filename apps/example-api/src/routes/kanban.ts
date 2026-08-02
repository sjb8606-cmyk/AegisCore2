/**
 * apps/example-api/src/routes/kanban.ts
 * Kanban — cards grouped by board_name/column_name.
 *
 * NOTE: boards are not a separate table here — a "board" is just the
 * board_name value cards share, kept as a single-table feature for
 * consistency with the rest of this batch rather than introducing a
 * two-table structure for one core.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const ListCardsQuerySchema = PaginationQuerySchema.extend({
  boardName: z.string().min(1).max(255),
});

const CreateCardSchema = z.object({
  boardName:  z.string().min(1).max(255),
  columnName: z.string().min(1).max(100).default('todo'),
  title:      z.string().min(1).max(255),
  position:   z.number().int().default(0),
});

const CardIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListCardsQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; column_name: string; title: string; position: number; created_at: string; updated_at: string }>(
        `SELECT id, column_name, title, position, created_at, updated_at FROM kanban_cards
         WHERE board_name = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.boardName, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'kanban_card', description: `Listed cards on board '${query.boardName}' (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateCardSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateCardSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; column_name: string; title: string; position: number; created_at: string; updated_at: string }>(
        `INSERT INTO kanban_cards (tenant_id, user_id, board_name, column_name, title, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, column_name, title, position, created_at, updated_at`,
        [tenantId, userId, input.boardName, input.columnName, input.title, input.position],
        tenantId,
      );

      const card = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'kanban_card', resourceId: card.id, description: `Created card '${input.title}' on board '${input.boardName}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${card.id}` });

      return created(res, card);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = CardIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM kanban_cards WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Card not found or not created by you', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'kanban_card', resourceId: id, description: `Removed card ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as kanbanRouter };
