import { Router, Request, Response } from 'express';
import { analyzeSentiment, updateHealthScore, getCustomerSentimentLedger, AppError, isValidUuid } from '../../../../platform/ai-sentiment/src/index';

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
    error: msg || 'An unexpected behavioral intelligence exception occurred.',
    code: code
  });
}

const paths = {
  analyze: ['/analyze', '/api/ai-sentiment/analyze'],
  health: ['/health', '/api/ai-sentiment/health'],
  ledger: ['/customers/:id/ledger', '/api/ai-sentiment/customers/:id/ledger']
};

router.post(paths.analyze, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await analyzeSentiment(tenantId, req.body.text, req.body.entityType, req.body.entityId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.health, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await updateHealthScore(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const customerId = req.params.id;
    if (!isValidUuid(customerId)) {
      throw new AppError(`Invalid Customer ID format: '${customerId}'`, 'BAD_REQUEST');
    }
    const result = await getCustomerSentimentLedger(tenantId, customerId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiSentimentRouter, router as 'ai-sentimentRouter' };
