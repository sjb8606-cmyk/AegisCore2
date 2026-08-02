/**
 * apps/example-api/src/routes/product-variants.ts
 * Product Variants — SKU variants of a base product.
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

const ListVariantsQuerySchema = PaginationQuerySchema.extend({
  productId: z.string().uuid(),
});

const CreateVariantSchema = z.object({
  productId:   z.string().uuid(),
  skuSuffix:   z.string().min(1).max(50),
  attributes:  z.record(z.any()).default({}),
  priceCents:  z.number().int().nonnegative(),
  stockCount:  z.number().int().nonnegative().default(0),
});

const VariantIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListVariantsQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; sku_suffix: string; attributes: Record<string, unknown>; price_cents: number; stock_count: number; created_at: string }>(
        `SELECT id, sku_suffix, attributes, price_cents, stock_count, created_at FROM product_variants
         WHERE product_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.productId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'product_variant', description: `Listed variants for product ${query.productId} (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateVariantSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateVariantSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; sku_suffix: string; attributes: Record<string, unknown>; price_cents: number; stock_count: number; created_at: string }>(
        `INSERT INTO product_variants (tenant_id, product_id, sku_suffix, attributes, price_cents, stock_count)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (tenant_id, product_id, sku_suffix)
         DO UPDATE SET attributes = EXCLUDED.attributes, price_cents = EXCLUDED.price_cents, stock_count = EXCLUDED.stock_count
         RETURNING id, sku_suffix, attributes, price_cents, stock_count, created_at`,
        [tenantId, input.productId, input.skuSuffix, JSON.stringify(input.attributes), input.priceCents, input.stockCount],
        tenantId,
      );

      const variant = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'product_variant', resourceId: variant.id, description: `Upserted variant '${input.skuSuffix}' for product ${input.productId}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${variant.id}` });

      return created(res, variant);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = VariantIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM product_variants WHERE id = $1 RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Variant not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'product_variant', resourceId: id, description: `Removed variant ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as productVariantsRouter };
