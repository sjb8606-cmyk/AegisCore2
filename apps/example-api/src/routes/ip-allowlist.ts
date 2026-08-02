/**
 * apps/example-api/src/routes/ip-allowlist.ts
 * IP Allowlist — permitted source IP ranges (CIDR).
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

// Basic IPv4/IPv6 CIDR shape check — not exhaustive RFC validation, but
// rejects obviously malformed input rather than accepting any string.
const CIDR_PATTERN = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/;
const CidrSchema = z.string().refine((val) => CIDR_PATTERN.test(val), { message: 'Must be a valid CIDR (e.g. 203.0.113.0/24)' });

const CreateAllowlistEntrySchema = z.object({
  ipCidr:      CidrSchema,
  description: z.string().max(500).optional(),
});

const EntryIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; ip_cidr: string; description: string | null; created_at: string }>(
        `SELECT id, ip_cidr, description, created_at FROM ip_allowlist_entries
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'ip_allowlist_entry', description: `Listed IP allowlist entries (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateAllowlistEntrySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateAllowlistEntrySchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; ip_cidr: string; description: string | null; created_at: string }>(
        `INSERT INTO ip_allowlist_entries (tenant_id, user_id, ip_cidr, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, ip_cidr) DO UPDATE SET description = EXCLUDED.description
         RETURNING id, ip_cidr, description, created_at`,
        [tenantId, userId, input.ipCidr, input.description ?? null],
        tenantId,
      );

      const entry = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'ip_allowlist_entry', resourceId: entry.id, description: `Added IP allowlist entry ${input.ipCidr}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${entry.id}` });

      return created(res, entry);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = EntryIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM ip_allowlist_entries WHERE id = $1 RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Allowlist entry not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'ip_allowlist_entry', resourceId: id, description: `Removed IP allowlist entry ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as ipAllowlistRouter };
