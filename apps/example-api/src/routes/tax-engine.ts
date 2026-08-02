/**
 * apps/example-api/src/routes/tax-engine.ts
 * Tax Engine — jurisdiction-based tax rate rules.
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

const CreateTaxRuleSchema = z.object({
  jurisdiction: z.string().min(1).max(100),
  ratePercent:  z.number().min(0).max(100),
  appliesTo:    z.string().min(1).max(100).default('all'),
});

const RuleIdParamSchema = z.object({ id: z.string().uuid() });

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; jurisdiction: string; rate_percent: string; applies_to: string; active: boolean; created_at: string }>(
        `SELECT id, jurisdiction, rate_percent, applies_to, active, created_at FROM tax_rules
         WHERE active = true
           AND ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'tax_rule', description: `Listed tax rules (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateTaxRuleSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateTaxRuleSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; jurisdiction: string; rate_percent: string; applies_to: string; active: boolean; created_at: string }>(
        `INSERT INTO tax_rules (tenant_id, jurisdiction, rate_percent, applies_to)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, jurisdiction, applies_to)
         DO UPDATE SET rate_percent = EXCLUDED.rate_percent, active = true
         RETURNING id, jurisdiction, rate_percent, applies_to, active, created_at`,
        [tenantId, input.jurisdiction, input.ratePercent, input.appliesTo],
        tenantId,
      );

      const rule = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'tax_rule', resourceId: rule.id, description: `Set tax rule for ${input.jurisdiction}: ${input.ratePercent}%` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${rule.id}` });

      return created(res, rule);
    } catch (err) { next(err); }
  }
);

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = RuleIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `UPDATE tax_rules SET active = false WHERE id = $1 AND active = true RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Tax rule not found or already inactive', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'tax_rule', resourceId: id, description: `Deactivated tax rule ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as taxEngineRouter };
