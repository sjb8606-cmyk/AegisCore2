/**
 * Veridact v1.0 — /v1/replay/:receipt_id Route
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { replayReceipt } from '../engines/replayEngine';
import { replayRateLimit } from '../middleware/rateLimiter';
import { requireApiKey, type AuthenticatedRequest } from '../middleware/auth';
import { addSpanAttributes } from '../middleware/otel';
import { logger } from '../db/logger';

export const replayRouter = Router();

const ParamsSchema = z.object({
  receipt_id: z.string().uuid('receipt_id must be a valid UUID'),
});

replayRouter.get(
  '/:receipt_id',
  requireApiKey,
  replayRateLimit,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const paramsParsed = ParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        throw paramsParsed.error;
      }

      const { receipt_id } = paramsParsed.data;
      const { actor, tenantId } = req;

      addSpanAttributes({
        'veridact.receipt_id': receipt_id,
        'veridact.operation': 'replay',
      });

      const result = await replayReceipt({
        tenantId,
        receiptId: receipt_id,
        actor,
      });

      addSpanAttributes({
        'veridact.replay_match': result.match,
        'veridact.event_type': result.event_type,
        'veridact.delta_count': result.delta.length,
      });

      logger.info(
        {
          receipt_id,
          tenant_id: tenantId,
          match: result.match,
          event_type: result.event_type,
          delta_fields: result.delta.map((d) => d.field),
        },
        'replay.complete'
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
