/**
 * apps/example-api/src/routes/approval-workflows.ts
 * Approval Workflows — generic pending/approved/rejected requests.
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

const CreateApprovalRequestSchema = z.object({
  requestType: z.string().min(1).max(100),
  payload:     z.record(z.any()).default({}),
});

const RequestIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; request_type: string; payload: Record<string, unknown>; status: string; approver_id: string | null; created_at: string; resolved_at: string | null }>(
        `SELECT id, request_type, payload, status, approver_id, created_at, resolved_at FROM approval_requests
         WHERE requester_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'approval_request', description: `Listed approval requests (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateApprovalRequestSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateApprovalRequestSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; request_type: string; payload: Record<string, unknown>; status: string; approver_id: string | null; created_at: string; resolved_at: string | null }>(
        `INSERT INTO approval_requests (tenant_id, requester_id, request_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, request_type, payload, status, approver_id, created_at, resolved_at`,
        [tenantId, userId, input.requestType, JSON.stringify(input.payload)],
        tenantId,
      );

      const request = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'approval_request', resourceId: request.id, description: `Submitted approval request '${input.requestType}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${request.id}` });

      return created(res, request);
    } catch (err) { next(err); }
  }
);

// DELETE here means "withdraw my own pending request" — not an approve/
// reject action, which would need a distinct approver-authority check
// beyond this batch's standard shape (same reasoning as vault.ts's
// deferred "reveal" endpoint: a real approve/reject flow deserves its
// own deliberate permission design, not a bolt-on here).
router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = RequestIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM approval_requests WHERE id = $1 AND requester_id = $2 AND status = 'pending' RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Approval request not found or no longer pending', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'approval_request', resourceId: id, description: `Withdrew approval request ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as approvalWorkflowsRouter };
