import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createRule, computePrice, runABTest, getPricingLedger, AppError, isValidUuid } from '../../../../platform/ai-pricing/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected pricing intelligence exception occurred.',
    code: code
  });
}

const paths = {
  rule: ['/rules', '/api/ai-pricing/rules'],
  compute: ['/compute', '/api/ai-pricing/compute'],
  experiment: ['/experiments', '/api/ai-pricing/experiments'],
  ledger: ['/products/:id/ledger', '/api/ai-pricing/products/:id/ledger']
};

router.post(paths.rule, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createRule(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.compute, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await computePrice(tenantId, req.body);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.experiment, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await runABTest(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const entityId = req.params.id;
    if (!isValidUuid(entityId)) {
      throw new AppError(`Invalid Product ID format: '${entityId}'`, 'BAD_REQUEST');
    }
    const result = await getPricingLedger(tenantId, entityId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiPricingRouter };
