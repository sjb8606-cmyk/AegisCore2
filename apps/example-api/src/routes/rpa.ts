/**
 * apps/example-api/src/routes/rpa.ts
 * RPA — robotic process automation task definitions.
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

const CreateTaskSchema = z.object({
  name:      z.string().min(1).max(255),
  targetApp: z.string().min(1).max(150),
  steps:     z.array(z.record(z.any())).min(1),
  enabled:   z.boolean().default(true),
});

const TaskIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; name: string; target_app: string; steps: unknown[]; enabled: boolean; created_at: string; updated_at: string }>(
        `SELECT id, name, target_app, steps, enabled, created_at, updated_at FROM rpa_tasks
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'rpa_task', description: `Listed RPA tasks (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateTaskSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateTaskSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; name: string; target_app: string; steps: unknown[]; enabled: boolean; created_at: string; updated_at: string }>(
        `INSERT INTO rpa_tasks (tenant_id, user_id, name, target_app, steps, enabled)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, name, target_app, steps, enabled, created_at, updated_at`,
        [tenantId, userId, input.name, input.targetApp, JSON.stringify(input.steps), input.enabled],
        tenantId,
      );

      const task = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'rpa_task', resourceId: task.id, description: `Created RPA task '${input.name}' for ${input.targetApp}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${task.id}` });

      return created(res, task);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = TaskIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM rpa_tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('RPA task not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'rpa_task', resourceId: id, description: `Removed RPA task ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as rpaRouter };
