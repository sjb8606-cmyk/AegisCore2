/**
 * apps/example-api/src/routes/triggers.ts
 *
 * Triggers — condition/action automation rules.
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

const CreateTriggerSchema = z.object({
  name:        z.string().min(1).max(255),
  triggerType: z.string().min(1).max(100),
  condition:   z.record(z.any()).default({}),
  action:      z.record(z.any()).default({}),
  enabled:     z.boolean().default(true),
});

const TriggerIdParamSchema = z.object({ id: z.string().uuid() });

// ── GET /items — list my triggers (paginated + ETag) ────────────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; name: string; trigger_type: string; condition: Record<string, unknown>; action: Record<string, unknown>; enabled: boolean; created_at: string }>(
        `SELECT id, name, trigger_type, condition, action, enabled, created_at FROM automation_triggers
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'automation_trigger', description: `Listed triggers (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

// ── POST /items — create a trigger ──────────────────────────────

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateTriggerSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateTriggerSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; name: string; trigger_type: string; condition: Record<string, unknown>; action: Record<string, unknown>; enabled: boolean; created_at: string }>(
        `INSERT INTO automation_triggers (tenant_id, user_id, name, trigger_type, condition, action, enabled)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
         RETURNING id, name, trigger_type, condition, action, enabled, created_at`,
        [tenantId, userId, input.name, input.triggerType, JSON.stringify(input.condition), JSON.stringify(input.action), input.enabled],
        tenantId,
      );

      const trigger = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'automation_trigger', resourceId: trigger.id, description: `Created trigger '${input.name}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${trigger.id}` });

      return created(res, trigger);
    } catch (err) { next(err); }
  }
);

// ── DELETE /items/:id — remove my trigger ────────────────────────

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = TriggerIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM automation_triggers WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Trigger not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'automation_trigger', resourceId: id, description: `Removed trigger ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as triggersRouter };
