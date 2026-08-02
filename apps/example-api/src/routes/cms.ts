/**
 * apps/example-api/src/routes/cms.ts
 * CMS — simple content pages.
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

const CreatePageSchema = z.object({
  slug:      z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'slug must be lowercase, alphanumeric, hyphen-separated'),
  title:     z.string().min(1).max(255),
  body:      z.string().min(1),
  published: z.boolean().default(false),
});

const PageIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; user_id: string; slug: string; title: string; body: string; published: boolean; created_at: string; updated_at: string }>(
        `SELECT id, user_id, slug, title, body, published, created_at, updated_at FROM cms_pages
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'cms_page', description: `Listed CMS pages (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreatePageSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreatePageSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; user_id: string; slug: string; title: string; body: string; published: boolean; created_at: string; updated_at: string }>(
        `INSERT INTO cms_pages (tenant_id, user_id, slug, title, body, published)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, slug)
         DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, published = EXCLUDED.published, updated_at = CURRENT_TIMESTAMP
         RETURNING id, user_id, slug, title, body, published, created_at, updated_at`,
        [tenantId, userId, input.slug, input.title, input.body, input.published],
        tenantId,
      );

      const page = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'cms_page', resourceId: page.id, description: `Upserted CMS page '${input.slug}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${page.id}` });

      return created(res, page);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = PageIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM cms_pages WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Page not found or not authored by you', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'cms_page', resourceId: id, description: `Removed CMS page ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as cmsRouter };
