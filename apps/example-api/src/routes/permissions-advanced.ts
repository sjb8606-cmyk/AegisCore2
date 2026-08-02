/**
 * apps/example-api/src/routes/permissions-advanced.ts
 * Permissions Advanced — fine-grained resource-level permission grants.
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

const CreateGrantSchema = z.object({
  granteeId:    z.string().uuid(),
  resourceType: z.string().min(1).max(100),
  resourceId:   z.string().uuid().optional(),
  permission:   z.string().min(1).max(50),
});

const GrantIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; granted_by: string; grantee_id: string; resource_type: string; resource_id: string | null; permission: string; created_at: string }>(
        `SELECT id, granted_by, grantee_id, resource_type, resource_id, permission, created_at FROM custom_permission_grants
         WHERE revoked_at IS NULL
           AND ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'custom_permission_grant', description: `Listed permission grants (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateGrantSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateGrantSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; granted_by: string; grantee_id: string; resource_type: string; resource_id: string | null; permission: string; created_at: string }>(
        `INSERT INTO custom_permission_grants (tenant_id, granted_by, grantee_id, resource_type, resource_id, permission)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, granted_by, grantee_id, resource_type, resource_id, permission, created_at`,
        [tenantId, userId, input.granteeId, input.resourceType, input.resourceId ?? null, input.permission],
        tenantId,
      );

      const grant = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'custom_permission_grant', resourceId: grant.id, description: `Granted '${input.permission}' on ${input.resourceType} to ${input.granteeId}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${grant.id}` });

      return created(res, grant);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = GrantIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE custom_permission_grants SET revoked_at = NOW() WHERE id = $1 AND granted_by = $2 AND revoked_at IS NULL RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Grant not found, already revoked, or not created by you', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'custom_permission_grant', resourceId: id, description: `Revoked permission grant ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as permissionsAdvancedRouter };
