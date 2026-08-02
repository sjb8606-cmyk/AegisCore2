/**
 * apps/example-api/src/routes/gift-cards.ts
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import type { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const IssueGiftCardSchema = z.object({
  initialBalanceCents: z.number().int().positive(),
  issuedToEmail:       z.string().email(),
});

const GiftCardIdParamSchema = z.object({ id: z.string().uuid() });

function generateGiftCardCode(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; code: string; initial_balance_cents: number; current_balance_cents: number; issued_to_email: string; status: string; created_at: string }>(
        `SELECT id, code, initial_balance_cents, current_balance_cents, issued_to_email, status, created_at FROM gift_cards
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'gift_card', description: `Listed gift cards (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(IssueGiftCardSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof IssueGiftCardSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const code = generateGiftCardCode();

      const rows = await withTenantQuery<{ id: string; code: string; initial_balance_cents: number; current_balance_cents: number; issued_to_email: string; status: string; created_at: string }>(
        `INSERT INTO gift_cards (tenant_id, code, initial_balance_cents, current_balance_cents, issued_to_email)
         VALUES ($1, $2, $3, $3, $4)
         RETURNING id, code, initial_balance_cents, current_balance_cents, issued_to_email, status, created_at`,
        [tenantId, code, input.initialBalanceCents, input.issuedToEmail],
        tenantId,
      );

      const giftCard = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'gift_card', resourceId: giftCard.id, description: `Issued gift card to ${input.issuedToEmail} for ${input.initialBalanceCents} cents` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${giftCard.id}` });

      return created(res, giftCard);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = GiftCardIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE gift_cards SET status = 'voided' WHERE id = $1 AND status = 'active' RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Gift card not found or already redeemed/voided', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'gift_card', resourceId: id, description: `Voided gift card ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as giftCardsRouter };
