/**
 * Veridact v1.0 — /v1/verify Route
 */

import { Router } from 'express';
import type { Response } from 'express';
import { ContextEnvelopeSchema } from '../schemas';
import { createReceipt } from '../engines/receiptEngine';
import { translate } from '../engines/translator';
import { verifyRateLimit } from '../middleware/rateLimiter';
import { requireApiKey, type AuthenticatedRequest } from '../middleware/auth';
import { addSpanAttributes } from '../middleware/otel';
import type { VerifyResponse } from '../types';
import { logger } from '../db/logger';

export const verifyRouter = Router();

verifyRouter.post(
  '/',
  requireApiKey,
  verifyRateLimit,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = ContextEnvelopeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw parsed.error;
      }

      const envelope = parsed.data;
      const { actor, tenantId } = req;

      addSpanAttributes({
        'veridact.rules_version': envelope.rules_version,
        'veridact.rules_hash': envelope.rules_hash,
        'veridact.has_idempotency_key': !!envelope.idempotency_key,
        'veridact.context_source': envelope.context.source,
        'veridact.context_trigger': envelope.context.trigger,
      });

      const { receipt, isNew } = await createReceipt({
        tenantId,
        envelope,
        actor,
      });

      addSpanAttributes({
        'veridact.receipt_id': receipt.receipt_id,
        'veridact.is_new': isNew,
        'veridact.hash': receipt.hash,
      });

      logger.info(
        {
          receipt_id: receipt.receipt_id,
          tenant_id: tenantId,
          is_new: isNew,
          idempotency_key: envelope.idempotency_key,
        },
        'verify.complete'
      );

      const response: VerifyResponse = {
        decision: (receipt.output as { decision?: string }).decision ?? 'PASS',
        receipt_id: receipt.receipt_id,
        hash: receipt.hash,
        rules_hash: receipt.rules_hash,
        timestamp: receipt.timestamp,
        replayable: true,
        event_type: 'new_receipt',
        human_message: translate('new_receipt'),
      };

      res.status(isNew ? 201 : 200).json(response);
    } catch (err) {
      next(err);
    }
  }
);
