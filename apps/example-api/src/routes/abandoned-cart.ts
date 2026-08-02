/**
 * apps/example-api/src/routes/abandoned-cart.ts
 * Abandoned Cart — tracking + recovery for abandoned carts.
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

const CreateAbandonedCartSchema = z.object({
  cartSnapshot: z.array(z.record(z.any())).min(1),
  totalCents:   z.number().int().nonnegative(),
});

const CartIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; cart_snapshot: unknown[]; total_cents: number; recovery_sent_at: string | null; recovered_at: string | null; created_at: string }>(
        `SELECT id, cart_snapshot, total_cents, recovery_sent_at, recovered_at, created_at FROM abandoned_carts
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'abandoned_cart', description: `Listed abandoned carts (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateAbandonedCartSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateAbandonedCartSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; cart_snapshot: unknown[]; total_cents: number; recovery_sent_at: string | null; recovered_at: string | null; created_at: string }>(
        `INSERT INTO abandoned_carts (tenant_id, user_id, cart_snapshot, total_cents)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, cart_snapshot, total_cents, recovery_sent_at, recovered_at, created_at`,
        [tenantId, userId, JSON.stringify(input.cartSnapshot), input.totalCents],
        tenantId,
      );

      const cart = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'abandoned_cart', resourceId: cart.id, description: `Recorded abandoned cart worth ${input.totalCents} cents` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${cart.id}` });

      return created(res, cart);
    } catch (err) { next(err); }
  }
);

// DELETE here marks the cart as recovered (the customer came back and
// completed checkout) rather than deleting the record — recovery data
// is useful for later analysis of what recovery tactics work.
router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = CartIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE abandoned_carts SET recovered_at = NOW() WHERE id = $1 AND user_id = $2 AND recovered_at IS NULL RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Abandoned cart not found or already marked recovered', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'abandoned_cart', resourceId: id, description: `Marked abandoned cart ${id} as recovered` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as abandonedCartRouter };
