/**
 * apps/example-api/src/routes/payroll.ts
 * Payroll — payroll run records (no actual payment processing here).
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

const CreatePayrollRunSchema = z.object({
  payPeriodStart:    z.string().date(),
  payPeriodEnd:      z.string().date(),
  totalGrossCents:   z.number().int().nonnegative(),
});

const RunIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; pay_period_start: string; pay_period_end: string; status: string; total_gross_cents: string; created_at: string; completed_at: string | null }>(
        `SELECT id, pay_period_start, pay_period_end, status, total_gross_cents, created_at, completed_at FROM payroll_runs
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'payroll_run', description: `Listed payroll runs (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreatePayrollRunSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreatePayrollRunSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      if (new Date(input.payPeriodEnd) < new Date(input.payPeriodStart)) {
        return next(new AppError('payPeriodEnd must not be before payPeriodStart', ErrorCode.UNPROCESSABLE));
      }

      const rows = await withTenantQuery<{ id: string; pay_period_start: string; pay_period_end: string; status: string; total_gross_cents: string; created_at: string; completed_at: string | null }>(
        `INSERT INTO payroll_runs (tenant_id, user_id, pay_period_start, pay_period_end, total_gross_cents)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, pay_period_start, pay_period_end, status, total_gross_cents, created_at, completed_at`,
        [tenantId, userId, input.payPeriodStart, input.payPeriodEnd, input.totalGrossCents],
        tenantId,
      );

      const run = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'payroll_run', resourceId: run.id, description: `Created payroll run for ${input.payPeriodStart} to ${input.payPeriodEnd}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${run.id}` });

      return created(res, run);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = RunIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE payroll_runs SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Payroll run not found or no longer in draft', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'payroll_run', resourceId: id, description: `Cancelled payroll run ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as payrollRouter };
