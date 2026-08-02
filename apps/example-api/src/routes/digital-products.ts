/**
 * apps/example-api/src/routes/digital-products.ts
 * Digital Products — downloadable product records.
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

const CreateDigitalProductSchema = z.object({
  name:          z.string().min(1).max(255),
  fileUrl:       z.string().url(),
  priceCents:    z.number().int().nonnegative(),
  downloadLimit: z.number().int().positive().optional(),
});

const ProductIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; name: string; file_url: string; price_cents: number; download_limit: number | null; active: boolean; created_at: string }>(
        `SELECT id, name, file_url, price_cents, download_limit, active, created_at FROM digital_products
         WHERE active = true
           AND ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'digital_product', description: `Listed digital products (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateDigitalProductSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateDigitalProductSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; name: string; file_url: string; price_cents: number; download_limit: number | null; active: boolean; created_at: string }>(
        `INSERT INTO digital_products (tenant_id, user_id, name, file_url, price_cents, download_limit)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, file_url, price_cents, download_limit, active, created_at`,
        [tenantId, userId, input.name, input.fileUrl, input.priceCents, input.downloadLimit ?? null],
        tenantId,
      );

      const product = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'digital_product', resourceId: product.id, description: `Created digital product '${input.name}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${product.id}` });

      return created(res, product);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = ProductIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE digital_products SET active = false WHERE id = $1 AND user_id = $2 AND active = true RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Digital product not found or already inactive', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'digital_product', resourceId: id, description: `Deactivated digital product ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as digitalProductsRouter };
