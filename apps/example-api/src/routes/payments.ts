import { Router, Request, Response } from 'express';
import { createPaymentIntent, confirmPaymentIntent, cancelPaymentIntent, attachPaymentMethod, issueRefund, ingestWebhookEvent, getPaymentLedger, AppError, isValidUuid } from '../../../../platform/payments/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw new AppError('Missing x-tenant-id', 'BAD_REQUEST');
  return { tenantId, userId };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected payments gateway exception occurred.',
    code: code
  });
}

const paths = {
  intent: ['/intents', '/api/payments/intents'],
  confirm: ['/intents/:id/confirm', '/api/payments/intents/:id/confirm'],
  cancel: ['/intents/:id/cancel', '/api/payments/intents/:id/cancel'],
  method: ['/methods', '/api/payments/methods'],
  refund: ['/refunds', '/api/payments/refunds'],
  webhook: ['/webhooks/:provider', '/api/payments/webhooks/:provider'],
  ledger: ['/intents/:id/ledger', '/api/payments/intents/:id/ledger']
};

router.post(paths.intent, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createPaymentIntent(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.confirm, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const intentId = req.params.id;
    if (!isValidUuid(intentId)) {
      throw new AppError(`Invalid Intent ID format: '${intentId}'`, 'BAD_REQUEST');
    }
    const result = await confirmPaymentIntent(tenantId, intentId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.cancel, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const intentId = req.params.id;
    if (!isValidUuid(intentId)) {
      throw new AppError(`Invalid Intent ID format: '${intentId}'`, 'BAD_REQUEST');
    }
    const result = await cancelPaymentIntent(tenantId, intentId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.method, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await attachPaymentMethod(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.refund, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await issueRefund(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.webhook, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await ingestWebhookEvent(tenantId, req.params.provider, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const intentId = req.params.id;
    if (!isValidUuid(intentId)) {
      throw new AppError(`Invalid Intent ID format: '${intentId}'`, 'BAD_REQUEST');
    }
    const result = await getPaymentLedger(tenantId, intentId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as paymentsRouter, router as 'paymentsRouter' };
