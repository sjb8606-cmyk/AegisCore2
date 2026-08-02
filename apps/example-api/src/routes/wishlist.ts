/**
 * apps/example-api/src/routes/wishlist.ts
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import type { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const AddWishlistItemSchema = z.object({
  productId:   z.string().uuid(),
  productName: z.string().min(1).max(255),
  note:        z.string().max(2000).optional(),
});

const WishlistItemIdParamSchema = z.object({
  id: z.string().uuid(),
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

      const rows = await withTenantQuery<{ id: string; product_id: string; product_name: string; note: string | null; created_at: string }>(
        `SELECT id, product_id, product_name, note, created_at FROM wishlist_items
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);

      if (handleETag(req, res, page)) return;

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.read',
        outcome:    'success',
        resource:   'wishlist_item',
        description: `Listed wishlist items (page cursor: ${query.cursor || 'start'})`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${Date.now()}`,
      });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(AddWishlistItemSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof AddWishlistItemSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; product_id: string; product_name: string; note: string | null; created_at: string }>(
        `INSERT INTO wishlist_items (tenant_id, user_id, product_id, product_name, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id, product_id)
         DO UPDATE SET note = EXCLUDED.note
         RETURNING id, product_id, product_name, note, created_at`,
        [tenantId, userId, input.productId, input.productName, input.note ?? null],
        tenantId,
      );

      const item = rows[0];

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.created',
        outcome:    'success',
        resource:   'wishlist_item',
        resourceId: item.id,
        description: `Added product '${input.productName}' to wishlist`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${item.id}`,
      });

      return created(res, item);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = WishlistItemIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Wishlist item not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({
        tenantId,
        actorId:    userId,
        actorType:  'user',
        action:     'data.deleted',
        outcome:    'success',
        resource:   'wishlist_item',
        resourceId: id,
        description: `Removed wishlist item ${id}`,
      });

      await recordUsage({
        tenantId,
        actorId:        userId,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${Date.now()}`,
      });

      return ok(res, { id });
    } catch (err) {
      next(err);
    }
  }
);

export { router as wishlistRouter };
