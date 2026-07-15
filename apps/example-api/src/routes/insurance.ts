import { Router, Request, Response } from 'express';
import { createHolder, createPolicy, submitClaim, getPolicyLedger, AppError, isValidUuid } from '../../../../platform/insurance/src/index';

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
  const status = code === 'FORBIDDEN' ? 403 : (code === 'CONFLICT' ? 409 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500)));
  
  res.status(status).json({ 
    error: msg || 'An unexpected insurance processing error occurred.',
    code: code
  });
}

const paths = {
  holder: ['/holders', '/api/insurance/holders'],
  policy: ['/policies', '/api/insurance/policies'],
  claim: ['/claims', '/api/insurance/claims'],
  ledger: ['/policies/:id/ledger', '/api/insurance/policies/:id/ledger']
};

router.post(paths.holder, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createHolder(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.policy, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createPolicy(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.claim, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await submitClaim(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const policyId = req.params.id;
    if (!isValidUuid(policyId)) {
      throw new AppError(`Invalid Policy ID format: '${policyId}'`, 'BAD_REQUEST');
    }
    const result = await getPolicyLedger(tenantId, policyId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as insuranceRouter, router as 'insuranceRouter' };
