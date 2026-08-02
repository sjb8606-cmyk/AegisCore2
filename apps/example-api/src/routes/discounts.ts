/**
 * apps/example-api/src/routes/discounts.ts
 * Discounts — discount codes with redemption limits.
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

const CreateDiscountSchema = z.object({
  code:            z.string().min(1).max(50),
  discountType:    z.enum(['percentage', 'fixed_amount']),
  discountValue:   z.number().int().positive(),
  maxRedemptions:  z.number().int().positive().optional(),
  expiresAt:       z.string().datetime().optional(),
});

const DiscountIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; code: string; discount_type: string; discount_value: number; max_redemptions: number | null; redemption_count: number; expires_at: string | null; created_at: string }>(
        `SELECT id, code, discount_type, discount_value, max_redemptions, redemption_count, expires_at, created_at FROM discount_codes
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'discount_code', description: `Listed discount codes (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateDiscountSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateDiscountSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      if (input.discountType === 'percentage' && input.discountValue > 100) {
        return next(new AppError('Percentage discount cannot exceed 100', ErrorCode.UNPROCESSABLE));
      }

      const rows = await withTenantQuery<{ id: string; code: string; discount_type: string; discount_value: number; max_redemptions: number | null; redemption_count: number; expires_at: string | null; created_at: string }>(
        `INSERT INTO discount_codes (tenant_id, code, discount_type, discount_value, max_redemptions, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, code, discount_type, discount_value, max_redemptions, redemption_count, expires_at, created_at`,
        [tenantId, input.code, input.discountType, input.discountValue, input.maxRedemptions ?? null, input.expiresAt ?? null],
        tenantId,
      );

      const discount = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'discount_code', resourceId: discount.id, description: `Created discount code '${input.code}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${discount.id}` });

      return created(res, discount);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = DiscountIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM discount_codes WHERE id = $1 RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Discount code not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'discount_code', resourceId: id, description: `Removed discount code ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as discountsRouter };
