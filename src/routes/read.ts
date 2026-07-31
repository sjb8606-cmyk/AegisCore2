/**
 * Veridact v1.0 — Read Routes
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { listReceipts, getReceiptById } from '../engines/receiptEngine';
import { listChanges } from '../engines/changeLog';
import { listAlerts } from '../engines/alertEngine';
import { translate, translateSafe } from '../engines/translator';
import { readRateLimit } from '../middleware/rateLimiter';
import { requireApiKey, type AuthenticatedRequest } from '../middleware/auth';
import {
  PaginationQuerySchema,
  ChangesQuerySchema,
  AlertsQuerySchema,
} from '../schemas';
import type { PaginatedResponse, Receipt, ChangeEntry, Alert } from '../types';

export const readRouter = Router();

readRouter.use(requireApiKey, readRateLimit);

readRouter.get('/receipts', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = PaginationQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const { page, limit } = parsed.data;
    const { tenantId } = req;

    const { rows, total } = await listReceipts(tenantId, page, limit);

    const response: PaginatedResponse<Receipt & { human_message: string }> = {
      data: rows.map((r) => ({
        ...r,
        human_message: translate('new_receipt'),
      })),
      pagination: {
        page,
        limit,
        total,
        has_next: page * limit < total,
      },
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

const ReceiptIdSchema = z.object({ id: z.string().uuid() });

readRouter.get('/receipts/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = ReceiptIdSchema.safeParse(req.params);
    if (!parsed.success) throw parsed.error;

    const { tenantId } = req;
    const receipt = await getReceiptById(tenantId, parsed.data.id);

    if (!receipt) {
      res.status(404).json({
        error: 'Not Found',
        message: `Receipt ${parsed.data.id} not found`,
      });
      return;
    }

    res.json({
      ...receipt,
      human_message: translate('new_receipt'),
    });
  } catch (err) {
    next(err);
  }
});

readRouter.get('/changes', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = ChangesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const { page, limit, actor_id, event_type, from, to } = parsed.data;
    const { tenantId } = req;

    const { rows, total } = await listChanges({
      tenantId,
      page,
      limit,
      actorId: actor_id,
      eventType: event_type,
      from,
      to,
    });

    const response: PaginatedResponse<ChangeEntry & { human_message: string }> = {
      data: rows.map((c) => ({
        ...c,
        human_message: translateSafe(c.event_type),
      })),
      pagination: {
        page,
        limit,
        total,
        has_next: page * limit < total,
      },
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

readRouter.get('/alerts', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = AlertsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const { page, limit, severity, event_type } = parsed.data;
    const { tenantId } = req;

    const { rows, total } = await listAlerts({
      tenantId,
      page,
      limit,
      severity,
      eventType: event_type,
    });

    const response: PaginatedResponse<Alert> = {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        has_next: page * limit < total,
      },
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});
