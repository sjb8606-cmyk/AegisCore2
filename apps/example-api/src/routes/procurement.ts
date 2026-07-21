import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createPurchaseRequest, submitPurchaseRequest, approvePurchaseRequest, getPurchaseDetails, ErrorCode } from '../../../../platform/procurement/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

// Aligned relative sub-paths to cleanly resolve the /api/procurement/requests/... URLs
const paths = {
  create: ['/', '/requests'],
  submit: ['/requests/:id/submit', '/:id/submit'],
  approve: ['/requests/:id/approve', '/:id/approve'],
  get: ['/requests/:id', '/:id']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const request = await createPurchaseRequest(tenantId, userId, req.body);
    res.status(201).json(request);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.submit, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await submitPurchaseRequest(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.approve, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await approvePurchaseRequest(tenantId, req.params.id, userId, req.body.reason);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getPurchaseDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as procurementRouter };
