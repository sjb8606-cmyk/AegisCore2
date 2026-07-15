/**
 * apps/example-api/src/routes/example.ts
 *
 * Demonstrates use of all platform packages:
 * - Pagination + ETag
 * - Tenant-scoped DB queries
 * - Audit events
 * - Metering
 * - AI safety validation
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { emit as auditEmit } from '@platform/audit';
import { recordUsage } from '@platform/metering';
import { validateLlmOutput } from '@platform/ai-safety';
import { requirePermission, ROLES, requireRole } from '@platform/auth';
import { ok, created, validateBody, validateQuery } from '@platform/utils';
import { PaginationQuerySchema, buildPage, handleETag } from '@platform/utils';
import { AuthenticatedRequest } from '@platform/auth';

const router = Router();

// ── GET /api/items — list items (paginated + ETag) ────────────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;

      // Fetch limit+1 to detect hasMore
      const rows = await withTenantQuery<{ id: string; name: string; created_at: string }>(
        `SELECT id, name, created_at FROM items
         WHERE deleted_at IS NULL
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $1`,
        [query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);

      // ETag check — return 304 if unchanged
      if (handleETag(req, res, page)) return;

      // Audit read
      await auditEmit({
        tenantId,
        actorId:    req.auth!.sub,
        actorType:  'user',
        action:     'data.read',
        outcome:    'success',
        resource:   'item',
        description: `Listed items (page cursor: ${query.cursor || 'start'})`,
      });

      // Meter API call
      await recordUsage({
        tenantId,
        actorId:        req.auth!.sub,
        eventType:      'api_call',
        quantity:        1,
        idempotencyKey:  `api:${req.method}:${req.path}:${Date.now()}`,
      });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/ai/validate — AI output validation demo ─────────

const AiRequestSchema = z.object({
  prompt:   z.string().min(1).max(10_000),
  response: z.string().min(1).max(50_000),
});

const ExpectedOutputSchema = z.object({
  summary: z.string(),
  safe:    z.boolean(),
});

router.post('/ai/validate',
  requireRole(ROLES.DEVELOPER),
  validateBody(AiRequestSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { prompt, response } = req.body as z.infer<typeof AiRequestSchema>;
      const tenantId = req.auth!.tenantId;

      const result = await validateLlmOutput(
        response,
        ExpectedOutputSchema,
        { prompt, tenantId, actorId: req.auth!.sub }
      );

      // Audit AI validation
      await auditEmit({
        tenantId,
        actorId:   req.auth!.sub,
        actorType: 'user',
        action:    result.valid ? 'ai.prompt_submitted' : 'ai.safety_violation',
        outcome:   result.valid ? 'success' : 'failure',
        resource:  'ai_response',
        metadata:  {
          violations: result.violations.length,
          filtered:   result.filtered,
        },
      });

      return ok(res, {
        valid:      result.valid,
        violations: result.violations,
        filtered:   result.filtered,
        data:       result.data,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { router as exampleRouter };
