/**
 * Mountable router: /api/shared-workspaces
 * Uses real DB via withTenantQuery when platform deps resolve.
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  type WorkspaceDb,
  WorkspaceError,
} from './src/index';

// Soft imports — same paths as example-api route
import { withTenantQuery } from '../tenancy/src/index';
import { emit as auditEmit } from '../audit/src/index';
import { recordUsage } from '../metering/src/index';
import { requireRole, ROLES, AuthenticatedRequest } from '../auth/src/index';
import { ok, created, validateBody, AppError, ErrorCode } from '../utils/src/index';

const router = Router();

function pgDb(): WorkspaceDb {
  return {
    async list(tenantId, opts) {
      return withTenantQuery(
        `SELECT id, user_id, name, description, member_ids, created_at FROM workspaces
         ORDER BY created_at ${opts.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $1`,
        [opts.limit],
        tenantId,
      );
    },
    async insert(row) {
      const rows = await withTenantQuery(
        `INSERT INTO workspaces (tenant_id, user_id, name, description, member_ids)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, user_id, name, description, member_ids, created_at`,
        [row.tenantId, row.userId, row.name, row.description, JSON.stringify(row.memberIds)],
        row.tenantId,
      );
      return rows[0];
    },
    async deleteOwned(tenantId, id, userId) {
      const rows = await withTenantQuery(
        `DELETE FROM workspaces WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );
      return rows[0] ?? null;
    },
    async countForTenant(tenantId) {
      const rows = await withTenantQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM workspaces`,
        [],
        tenantId,
      );
      return Number(rows[0]?.count ?? 0);
    },
  };
}

router.get(
  '/items',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const data = await listWorkspaces(pgDb(), tenantId, { limit: 50 });
      await auditEmit({
        tenantId,
        actorId: userId,
        actorType: 'user',
        action: 'data.read',
        outcome: 'success',
        resource: 'workspace',
      });
      return ok(res, data);
    } catch (err) {
      next(mapErr(err));
    }
  },
);

router.post(
  '/items',
  requireRole(ROLES.VIEWER),
  validateBody(
    z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      memberIds: z.array(z.string().uuid()).default([]),
      rootPageId: z.string().uuid().optional(),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const ws = await createWorkspace(pgDb(), tenantId, userId, req.body);
      await auditEmit({
        tenantId,
        actorId: userId,
        actorType: 'user',
        action: 'data.created',
        outcome: 'success',
        resource: 'workspace',
        resourceId: ws.id,
      });
      await recordUsage({
        tenantId,
        actorId: userId,
        eventType: 'api_call',
        quantity: 1,
        idempotencyKey: `ws:create:${ws.id}`,
      });
      return created(res, ws);
    } catch (err) {
      next(mapErr(err));
    }
  },
);

router.delete(
  '/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const result = await deleteWorkspace(pgDb(), tenantId, id, userId);
      await auditEmit({
        tenantId,
        actorId: userId,
        actorType: 'user',
        action: 'data.deleted',
        outcome: 'success',
        resource: 'workspace',
        resourceId: id,
      });
      return ok(res, result);
    } catch (err) {
      next(mapErr(err));
    }
  },
);

function mapErr(err: unknown) {
  if (err instanceof WorkspaceError) {
    return new AppError(err.message, err.statusCode === 404 ? ErrorCode.NOT_FOUND : ErrorCode.BAD_REQUEST);
  }
  return err;
}

export { router as sharedWorkspacesRouter };
export default router;
