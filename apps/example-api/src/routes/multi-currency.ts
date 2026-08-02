/**
 * apps/example-api/src/routes/multi-currency.ts
 * Multi-Currency — exchange rate records.
 *
 * NOTE: no DELETE endpoint — exchange rates are historical financial
 * records; a superseded rate is replaced by recording a newer one with
 * a later effective_at, not by deleting the old one (same append-only
 * reasoning as ledger.ts).
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

const ListRatesQuerySchema = PaginationQuerySchema.extend({
  baseCurrency:  z.string().length(3),
  quoteCurrency: z.string().length(3),
});

const CreateRateSchema = z.object({
  baseCurrency:  z.string().length(3),
  quoteCurrency: z.string().length(3),
  rate:          z.number().positive(),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListRatesQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; rate: string; effective_at: string; created_at: string }>(
        `SELECT id, rate, effective_at, created_at FROM exchange_rates
         WHERE base_currency = $1 AND quote_currency = $2
           AND ($3::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $3::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $4`,
        [query.baseCurrency, query.quoteCurrency, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'exchange_rate', description: `Listed ${query.baseCurrency}/${query.quoteCurrency} rates (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateRateSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateRateSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; rate: string; effective_at: string; created_at: string }>(
        `INSERT INTO exchange_rates (tenant_id, base_currency, quote_currency, rate)
         VALUES ($1, $2, $3, $4)
         RETURNING id, rate, effective_at, created_at`,
        [tenantId, input.baseCurrency, input.quoteCurrency, input.rate],
        tenantId,
      );

      const rate = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'exchange_rate', resourceId: rate.id, description: `Recorded ${input.baseCurrency}/${input.quoteCurrency} rate: ${input.rate}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${rate.id}` });

      return created(res, rate);
    } catch (err) { next(err); }
  }
);

export { router as multiCurrencyRouter };
