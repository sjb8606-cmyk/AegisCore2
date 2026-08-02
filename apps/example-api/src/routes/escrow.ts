/**
 * apps/example-api/src/routes/escrow.ts
 * Escrow — held funds pending release/refund.
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

const CreateEscrowSchema = z.object({
  counterpartyId: z.string().uuid(),
  amountCents:    z.number().int().positive(),
  currency:       z.string().length(3).default('USD'),
});

const EscrowIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; counterparty_id: string; amount_cents: string; currency: string; status: string; created_at: string; resolved_at: string | null }>(
        `SELECT id, counterparty_id, amount_cents, currency, status, created_at, resolved_at FROM escrow_accounts
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'escrow_account', description: `Listed escrow accounts (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateEscrowSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateEscrowSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; counterparty_id: string; amount_cents: string; currency: string; status: string; created_at: string; resolved_at: string | null }>(
        `INSERT INTO escrow_accounts (tenant_id, user_id, counterparty_id, amount_cents, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, counterparty_id, amount_cents, currency, status, created_at, resolved_at`,
        [tenantId, userId, input.counterpartyId, input.amountCents, input.currency],
        tenantId,
      );

      const escrow = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'escrow_account', resourceId: escrow.id, description: `Opened escrow of ${input.amountCents} ${input.currency} with ${input.counterpartyId}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${escrow.id}` });

      return created(res, escrow);
    } catch (err) { next(err); }
  }
);

// DELETE here means "release the held funds" (the standard successful
// resolution) — a refund/dispute path would be a distinct action beyond
// this batch's standard shape, same reasoning as approval-workflows.ts.
router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = EscrowIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE escrow_accounts SET status = 'released', resolved_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'held' RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Escrow account not found or already resolved', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'escrow_account', resourceId: id, description: `Released escrow ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as escrowRouter };
