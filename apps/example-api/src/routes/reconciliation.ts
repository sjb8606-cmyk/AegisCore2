/**
 * apps/example-api/src/routes/reconciliation.ts
 * Reconciliation — statement-vs-ledger discrepancy tracking.
 *
 * NOTE: discrepancy_cents is a real Postgres GENERATED ALWAYS column
 * (statement_total_cents - ledger_total_cents), computed by the database
 * — never set directly by the INSERT.
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

const ListReconciliationQuerySchema = PaginationQuerySchema.extend({
  account: z.string().min(1).max(100),
});

const CreateRecordSchema = z.object({
  account:              z.string().min(1).max(100),
  statementTotalCents:  z.number().int(),
  ledgerTotalCents:     z.number().int(),
  notes:                z.string().max(2000).optional(),
});

const RecordIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(ListReconciliationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; statement_total_cents: string; ledger_total_cents: string; discrepancy_cents: string; status: string; notes: string | null; created_at: string }>(
        `SELECT id, statement_total_cents, ledger_total_cents, discrepancy_cents, status, notes, created_at FROM reconciliation_records
         WHERE account = $1
           AND ($2::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $2::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $3`,
        [query.account, cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'reconciliation_record', description: `Listed reconciliation records for '${query.account}' (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateRecordSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateRecordSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; statement_total_cents: string; ledger_total_cents: string; discrepancy_cents: string; status: string; notes: string | null; created_at: string }>(
        `INSERT INTO reconciliation_records (tenant_id, user_id, account, statement_total_cents, ledger_total_cents, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, statement_total_cents, ledger_total_cents, discrepancy_cents, status, notes, created_at`,
        [tenantId, userId, input.account, input.statementTotalCents, input.ledgerTotalCents, input.notes ?? null],
        tenantId,
      );

      const record = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'reconciliation_record', resourceId: record.id, description: `Recorded reconciliation for '${input.account}' (discrepancy: ${record.discrepancy_cents})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${record.id}` });

      return created(res, record);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = RecordIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE reconciliation_records SET status = 'resolved', resolved_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'open' RETURNING id`,
        [id, userId],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Reconciliation record not found or already resolved', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'reconciliation_record', resourceId: id, description: `Resolved reconciliation record ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as reconciliationRouter };
