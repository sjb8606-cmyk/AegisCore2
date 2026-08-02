/**
 * apps/example-api/src/routes/cron-jobs.ts
 *
 * Cron Jobs — user-defined scheduled jobs.
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

// Loose but real validation of standard 5-field cron syntax
// (minute hour day-of-month month day-of-week) — doesn't validate
// range/step syntax in depth, but rejects obviously malformed input.
const CRON_FIELD = /^(\*|[0-9,\-/]+)$/;
const CronExpressionSchema = z.string().refine((val) => {
  const parts = val.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}, { message: 'Must be a valid 5-field cron expression (e.g. "0 * * * *")' });

const CreateJobSchema = z.object({
  name:           z.string().min(1).max(255),
  cronExpression: CronExpressionSchema,
  jobType:        z.string().min(1).max(100),
  payload:        z.record(z.any()).default({}),
  enabled:        z.boolean().default(true),
});

const JobIdParamSchema = z.object({ id: z.string().uuid() });

// ── GET /items — list my scheduled jobs (paginated + ETag) ──────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; name: string; cron_expression: string; job_type: string; payload: Record<string, unknown>; enabled: boolean; last_run_at: string | null; created_at: string }>(
        `SELECT id, name, cron_expression, job_type, payload, enabled, last_run_at, created_at FROM scheduled_jobs
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'scheduled_job', description: `Listed scheduled jobs (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

// ── POST /items — create a scheduled job ────────────────────────

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateJobSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateJobSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; name: string; cron_expression: string; job_type: string; payload: Record<string, unknown>; enabled: boolean; last_run_at: string | null; created_at: string }>(
        `INSERT INTO scheduled_jobs (tenant_id, user_id, name, cron_expression, job_type, payload, enabled)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING id, name, cron_expression, job_type, payload, enabled, last_run_at, created_at`,
        [tenantId, userId, input.name, input.cronExpression, input.jobType, JSON.stringify(input.payload), input.enabled],
        tenantId,
      );

      const job = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'scheduled_job', resourceId: job.id, description: `Created scheduled job '${input.name}' (${input.cronExpression})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${job.id}` });

      return created(res, job);
    } catch (err) { next(err); }
  }
);

// ── DELETE /items/:id — remove my scheduled job ──────────────────

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = JobIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM scheduled_jobs WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Scheduled job not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'scheduled_job', resourceId: id, description: `Removed scheduled job ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as cronJobsRouter };
