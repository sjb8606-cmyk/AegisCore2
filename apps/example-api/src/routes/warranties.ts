import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { registerWarranty, submitClaim, getWarrantyLedger, AppError, isValidUuid } from '../../../../platform/warranties/src/index';

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
    error: msg || 'An unexpected internal error occurred.',
    code: code
  });
}

const paths = {
  register: ['/contracts', '/api/warranties/contracts'],
  claim: ['/claims', '/api/warranties/claims'],
  ledger: ['/contracts/:id/ledger', '/api/warranties/contracts/:id/ledger']
};

router.post(paths.register, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await registerWarranty(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.claim, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await submitClaim(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const warrantyId = req.params.id;
    if (!isValidUuid(warrantyId)) {
      throw new AppError(`Invalid contract ID format: '${warrantyId}'`, 'BAD_REQUEST');
    }
    const result = await getWarrantyLedger(tenantId, warrantyId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as warrantiesRouter };
