/**
 * apps/example-api/src/routes/gantt.ts
 * Gantt — project timeline items grouped by project_name.
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

const ListGanttQuerySchema = PaginationQuerySchema.extend({
  projectName: z.string().min(1).max(255),
});

const CreateGanttItemSchema = z.object({
  projectName: z.string().min(1).max(255),
  title:       z.string().min(1).max(255),
  startDate:   z.string().date(),
  endDate:     z.string().date(),
  progressPct: z.number().int().min(0).max(100).default(0),
});

const ItemIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListGanttQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; title: string; start_date: string; end_date: string; progress_pct: number; created_at: string }>(
        `SELECT id, title, start_date, end_date, progress_pct, created_at FROM gantt_items
         WHERE project_name = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.projectName, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'gantt_item', description: `Listed gantt items for project '${query.projectName}' (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateGanttItemSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateGanttItemSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      if (new Date(input.endDate) < new Date(input.startDate)) {
        return next(new AppError('endDate must not be before startDate', ErrorCode.UNPROCESSABLE));
      }

      const rows = await withTenantQuery<{ id: string; title: string; start_date: string; end_date: string; progress_pct: number; created_at: string }>(
        `INSERT INTO gantt_items (tenant_id, user_id, project_name, title, start_date, end_date, progress_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, start_date, end_date, progress_pct, created_at`,
        [tenantId, userId, input.projectName, input.title, input.startDate, input.endDate, input.progressPct],
        tenantId,
      );

      const item = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'gantt_item', resourceId: item.id, description: `Created gantt item '${input.title}' on project '${input.projectName}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${item.id}` });

      return created(res, item);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = ItemIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM gantt_items WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Gantt item not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'gantt_item', resourceId: id, description: `Removed gantt item ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as ganttRouter };
