/**
 * apps/example-api/src/routes/revenue-recognition.ts
 * Revenue Recognition — recognition schedules for contracts.
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

const CreateScheduleSchema = z.object({
  contractRef:        z.string().min(1).max(255),
  totalAmountCents:    z.number().int().positive(),
  recognitionStart:    z.string().date(),
  recognitionEnd:      z.string().date(),
  method:              z.enum(['straight_line', 'milestone', 'usage_based']).default('straight_line'),
});

const ScheduleIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; contract_ref: string; total_amount_cents: string; recognition_start: string; recognition_end: string; method: string; created_at: string }>(
        `SELECT id, contract_ref, total_amount_cents, recognition_start, recognition_end, method, created_at FROM revenue_recognition_schedules
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'revenue_recognition_schedule', description: `Listed revenue recognition schedules (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateScheduleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateScheduleSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      if (new Date(input.recognitionEnd) < new Date(input.recognitionStart)) {
        return next(new AppError('recognitionEnd must not be before recognitionStart', ErrorCode.UNPROCESSABLE));
      }

      const rows = await withTenantQuery<{ id: string; contract_ref: string; total_amount_cents: string; recognition_start: string; recognition_end: string; method: string; created_at: string }>(
        `INSERT INTO revenue_recognition_schedules (tenant_id, user_id, contract_ref, total_amount_cents, recognition_start, recognition_end, method)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, contract_ref, total_amount_cents, recognition_start, recognition_end, method, created_at`,
        [tenantId, userId, input.contractRef, input.totalAmountCents, input.recognitionStart, input.recognitionEnd, input.method],
        tenantId,
      );

      const schedule = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'revenue_recognition_schedule', resourceId: schedule.id, description: `Created recognition schedule for '${input.contractRef}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${schedule.id}` });

      return created(res, schedule);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = ScheduleIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM revenue_recognition_schedules WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Schedule not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'revenue_recognition_schedule', resourceId: id, description: `Removed recognition schedule ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as revenueRecognitionRouter };
