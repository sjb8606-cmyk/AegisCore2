/**
 * apps/example-api/src/routes/crypto-payments.ts
 * Crypto Payments — cryptocurrency payment records.
 *
 * NOTE: no DELETE — crypto payments reference on-chain transactions,
 * which aren't reversible by this API. A failed/stale pending payment
 * would be marked failed by a real chain-monitoring process, not
 * deleted here.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreatePaymentSchema = z.object({
  currencyCode:  z.string().min(2).max(10),
  amount:        z.number().positive(),
  walletAddress: z.string().min(10).max(255),
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

      const rows = await withTenantQuery<{ id: string; currency_code: string; amount: string; wallet_address: string; tx_hash: string | null; status: string; created_at: string; confirmed_at: string | null }>(
        `SELECT id, currency_code, amount, wallet_address, tx_hash, status, created_at, confirmed_at FROM crypto_payments
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [userId, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'crypto_payment', description: `Listed crypto payments (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreatePaymentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreatePaymentSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; currency_code: string; amount: string; wallet_address: string; tx_hash: string | null; status: string; created_at: string; confirmed_at: string | null }>(
        `INSERT INTO crypto_payments (tenant_id, user_id, currency_code, amount, wallet_address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, currency_code, amount, wallet_address, tx_hash, status, created_at, confirmed_at`,
        [tenantId, userId, input.currencyCode, input.amount, input.walletAddress],
        tenantId,
      );

      const payment = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'crypto_payment', resourceId: payment.id, description: `Created pending ${input.amount} ${input.currencyCode} payment` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${payment.id}` });

      return created(res, payment);
    } catch (err) { next(err); }
  }
);

export { router as cryptoPaymentsRouter };
