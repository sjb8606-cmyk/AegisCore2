import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createReturnRequest, approveReturn, processRefund, getReturnRequest, AppError, isValidUuid } from '../../../../platform/returns/src/index';

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
  create: ['/requests', '/api/returns/requests'],
  get: ['/requests/:id', '/api/returns/requests/:id'],
  approve: ['/requests/:id/approve', '/api/returns/requests/:id/approve'],
  refund: ['/requests/:id/refund', '/api/returns/requests/:id/refund']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await createReturnRequest(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const returnId = req.params.id;
    if (!isValidUuid(returnId)) {
      throw new AppError(`Invalid Return Request ID format: '${returnId}'`, 'BAD_REQUEST');
    }
    const result = await getReturnRequest(tenantId, returnId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.approve, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const returnId = req.params.id;
    if (!isValidUuid(returnId)) {
      throw new AppError(`Invalid Return Request ID format: '${returnId}'`, 'BAD_REQUEST');
    }
    const result = await approveReturn(tenantId, returnId, userId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.refund, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const returnId = req.params.id;
    if (!isValidUuid(returnId)) {
      throw new AppError(`Invalid Return Request ID format: '${returnId}'`, 'BAD_REQUEST');
    }
    const result = await processRefund(tenantId, returnId, req.body.amount_cents);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as returnsRouter };
