/**
 * apps/example-api/src/routes/pci-tools.ts
 * PCI Tools — cardholder-data-environment access logging.
 *
 * NOTE: no DELETE — same reasoning as hipaa-tools.ts: access logs are
 * compliance records and must not be removable via this API. This logs
 * WHO accessed cardholder data and WHY — never the cardholder data itself.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const ListLogsQuerySchema = PaginationQuerySchema.extend({
  resourceRef: z.string().min(1).max(255),
});

const LogAccessSchema = z.object({
  resourceRef:  z.string().min(1).max(255),
  accessReason: z.string().min(1).max(255),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListLogsQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; accessor_id: string; access_reason: string; accessed_at: string }>(
        `SELECT id, accessor_id, access_reason, accessed_at FROM cde_access_logs
         WHERE resource_ref = $1
           AND ($2::timestamptz IS NULL OR accessed_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY accessed_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.resourceRef, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'accessed_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'cde_access_log', description: `Listed CDE access logs for ${query.resourceRef} (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(LogAccessSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof LogAccessSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; accessor_id: string; access_reason: string; accessed_at: string }>(
        `INSERT INTO cde_access_logs (tenant_id, accessor_id, resource_ref, access_reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id, accessor_id, access_reason, accessed_at`,
        [tenantId, userId, input.resourceRef, input.accessReason],
        tenantId,
      );

      const log = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'cde_access_log', resourceId: log.id, description: `Logged CDE access to ${input.resourceRef}: ${input.accessReason}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${log.id}` });

      return created(res, log);
    } catch (err) { next(err); }
  }
);

export { router as pciToolsRouter };
