/**
 * apps/example-api/src/routes/tax-reporting.ts
 * Tax Reporting — generated tax report records.
 *
 * NOTE: no DELETE — filed tax reports are historical/legal records and
 * must not be removable via this API. A draft can still be superseded
 * by generating a new one; nothing here destroys a filed report.
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

const CreateTaxReportSchema = z.object({
  periodStart:    z.string().date(),
  periodEnd:      z.string().date(),
  jurisdiction:   z.string().min(1).max(100),
  totalTaxCents:  z.number().int().nonnegative(),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; period_start: string; period_end: string; jurisdiction: string; total_tax_cents: string; status: string; created_at: string; filed_at: string | null }>(
        `SELECT id, period_start, period_end, jurisdiction, total_tax_cents, status, created_at, filed_at FROM tax_reports
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'tax_report', description: `Listed tax reports (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateTaxReportSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateTaxReportSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      if (new Date(input.periodEnd) < new Date(input.periodStart)) {
        return next(new AppError('periodEnd must not be before periodStart', ErrorCode.UNPROCESSABLE));
      }

      const rows = await withTenantQuery<{ id: string; period_start: string; period_end: string; jurisdiction: string; total_tax_cents: string; status: string; created_at: string; filed_at: string | null }>(
        `INSERT INTO tax_reports (tenant_id, user_id, period_start, period_end, jurisdiction, total_tax_cents)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, period_start, period_end, jurisdiction, total_tax_cents, status, created_at, filed_at`,
        [tenantId, userId, input.periodStart, input.periodEnd, input.jurisdiction, input.totalTaxCents],
        tenantId,
      );

      const report = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'tax_report', resourceId: report.id, description: `Generated tax report for '${input.jurisdiction}' (${input.periodStart} to ${input.periodEnd})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${report.id}` });

      return created(res, report);
    } catch (err) { next(err); }
  }
);

export { router as taxReportingRouter };
