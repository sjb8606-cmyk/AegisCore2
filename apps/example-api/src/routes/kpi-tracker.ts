/**
 * apps/example-api/src/routes/kpi-tracker.ts
 *
 * KPI Tracker — track progress against personal/team targets.
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

const CreateKpiSchema = z.object({
  name:         z.string().min(1).max(255),
  targetValue:  z.number(),
  currentValue: z.number().default(0),
  unit:         z.string().max(50).optional(),
  period:       z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
});

const KpiIdParamSchema = z.object({ id: z.string().uuid() });

// ── GET /items — list my KPIs (paginated + ETag) ────────────────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; name: string; target_value: string; current_value: string; unit: string | null; period: string; created_at: string }>(
        `SELECT id, name, target_value, current_value, unit, period, created_at FROM kpis
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'kpi', description: `Listed KPIs (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

// ── POST /items — create a KPI ──────────────────────────────────

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateKpiSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateKpiSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; name: string; target_value: string; current_value: string; unit: string | null; period: string; created_at: string }>(
        `INSERT INTO kpis (tenant_id, user_id, name, target_value, current_value, unit, period)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, target_value, current_value, unit, period, created_at`,
        [tenantId, userId, input.name, input.targetValue, input.currentValue, input.unit ?? null, input.period],
        tenantId,
      );

      const kpi = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'kpi', resourceId: kpi.id, description: `Created KPI '${input.name}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${kpi.id}` });

      return created(res, kpi);
    } catch (err) { next(err); }
  }
);

// ── DELETE /items/:id — remove my KPI ────────────────────────────

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = KpiIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM kpis WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('KPI not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'kpi', resourceId: id, description: `Removed KPI ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as kpiTrackerRouter };
