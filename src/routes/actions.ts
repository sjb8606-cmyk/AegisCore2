/**
 * Veridact — Actions & Approvals Routes
 *
 * POST /v1/actions/intercept        — run the MCP Interceptor pipeline
 *                                      (Coverage Boundary → Policy → HITL)
 *                                      against a proposed action.
 * POST /v1/approvals/:id/resolve    — a named human approves/rejects a
 *                                      pending HITL approval.
 * GET  /v1/approvals/:id            — check an approval's current status.
 *
 * These are the first real HTTP surface for Coverage Boundary, HITL Gate,
 * and the MCP Interceptor — previously built and tested in isolation, but
 * never actually reachable via the live API.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { interceptAction, MissingApproverError } from '../engines/mcpInterceptor';
import { getBoundary } from '../engines/boundaryStore';
import { getPolicyBundle } from '../engines/policyBundleStore';
import { resolveApprovalById, getApproval } from '../engines/hitlStore';
import { readRateLimit, verifyRateLimit } from '../middleware/rateLimiter';
import { requireApiKey, type AuthenticatedRequest } from '../middleware/auth';
import { addSpanAttributes } from '../middleware/otel';
import { logger } from '../db/logger';

export const actionsRouter = Router();

actionsRouter.use(requireApiKey);

const ProposedActionSchema = z.object({
  action: z.string().min(1),
  resource_id: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

const InterceptRequestSchema = z.object({
  action: ProposedActionSchema,
  boundary_id: z.string().min(1),
  rules_version: z.string().min(1),
  rules_hash: z.string().length(64).regex(/^[a-f0-9]+$/),
  assigned_approver_id: z.string().min(1).optional(),
  hitl_ttl_seconds: z.number().int().positive().optional(),
});

actionsRouter.post('/actions/intercept', verifyRateLimit, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = InterceptRequestSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { action, boundary_id, rules_version, rules_hash, assigned_approver_id, hitl_ttl_seconds } =
      parsed.data;
    const { tenantId } = req;

    const boundary = await getBoundary(boundary_id, tenantId);
    const policyBundle = await getPolicyBundle(tenantId, rules_version, rules_hash);

    addSpanAttributes({
      'veridact.action': action.action,
      'veridact.resource_id': action.resource_id,
      'veridact.boundary_id': boundary_id,
    });

    const result = await interceptAction({
      tenantId,
      action,
      boundary,
      policyBundle,
      assignedApproverId: assigned_approver_id,
      hitlTtlSeconds: hitl_ttl_seconds,
    });

    addSpanAttributes({
      'veridact.outcome': result.outcome,
      'veridact.approval_id': result.approval_id ?? '',
    });

    logger.info(
      {
        tenant_id: tenantId,
        action: action.action,
        outcome: result.outcome,
        approval_id: result.approval_id,
      },
      'actions.intercept.complete'
    );

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MissingApproverError) {
      (err as MissingApproverError & { statusCode: number }).statusCode = 400;
    }
    next(err);
  }
});

const ResolveApprovalParamsSchema = z.object({ id: z.string().min(1) });

const ResolveApprovalBodySchema = z.object({
  resolver_id: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2048).optional(),
});

actionsRouter.post(
  '/approvals/:id/resolve',
  verifyRateLimit,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const paramsParsed = ResolveApprovalParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) throw paramsParsed.error;

      const bodyParsed = ResolveApprovalBodySchema.safeParse(req.body);
      if (!bodyParsed.success) throw bodyParsed.error;

      const { id } = paramsParsed.data;
      const { resolver_id, decision, note } = bodyParsed.data;
      const { tenantId } = req;

      const resolved = await resolveApprovalById(id, tenantId, resolver_id, decision, note);

      logger.info(
        { tenant_id: tenantId, approval_id: id, resolver_id, decision },
        'approvals.resolve.complete'
      );

      res.status(200).json(resolved);
    } catch (err) {
      next(err);
    }
  }
);

const GetApprovalParamsSchema = z.object({ id: z.string().min(1) });

actionsRouter.get(
  '/approvals/:id',
  readRateLimit,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = GetApprovalParamsSchema.safeParse(req.params);
      if (!parsed.success) throw parsed.error;

      const { tenantId } = req;
      const approval = await getApproval(parsed.data.id, tenantId);

      res.status(200).json(approval);
    } catch (err) {
      next(err);
    }
  }
);
