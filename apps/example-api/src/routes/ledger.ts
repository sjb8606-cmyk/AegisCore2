/**
 * apps/example-api/src/routes/ledger.ts
 * Ledger — append-only general ledger entries.
 *
 * NOTE: no DELETE endpoint — ledger entries are financial records and
 * must be append-only for audit integrity. A mistaken entry should be
 * corrected with an offsetting entry, not deleted.
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

const ListLedgerQuerySchema = PaginationQuerySchema.extend({
  account: z.string().min(1).max(100),
});

const CreateLedgerEntrySchema = z.object({
  account:      z.string().min(1).max(100),
  entryType:    z.enum(['debit', 'credit']),
  amountCents:  z.number().int().positive(),
  currency:     z.string().length(3).default('USD'),
  description:  z.string().max(2000).optional(),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListLedgerQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; user_id: string; entry_type: string; amount_cents: number; currency: string; description: string | null; created_at: string }>(
        `SELECT id, user_id, entry_type, amount_cents, currency, description, created_at FROM ledger_entries
         WHERE account = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.account, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'ledger_entry', description: `Listed ledger entries for account '${query.account}' (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateLedgerEntrySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateLedgerEntrySchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; user_id: string; entry_type: string; amount_cents: number; currency: string; description: string | null; created_at: string }>(
        `INSERT INTO ledger_entries (tenant_id, user_id, account, entry_type, amount_cents, currency, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, entry_type, amount_cents, currency, description, created_at`,
        [tenantId, userId, input.account, input.entryType, input.amountCents, input.currency, input.description ?? null],
        tenantId,
      );

      const entry = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'ledger_entry', resourceId: entry.id, description: `Recorded ${input.entryType} of ${input.amountCents} ${input.currency} to '${input.account}'` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${entry.id}` });

      return created(res, entry);
    } catch (err) { next(err); }
  }
);

export { router as ledgerRouter };
