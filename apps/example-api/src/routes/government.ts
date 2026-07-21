import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { submitServiceRequest, submitAtipRequest, getAtipRequest, ErrorCode } from '../../../../platform/government/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId };
}

const paths = {
  createServiceRequest: ['/service-requests', '/api/government/service-requests'],
  createAtip: ['/atip-requests', '/api/government/atip-requests'],
  getAtip: ['/atip-requests/:id', '/api/government/atip-requests/:id']
};

router.post(paths.createServiceRequest, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const request = await submitServiceRequest(tenantId, req.body);
    res.status(201).json(request);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createAtip, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const atip = await submitAtipRequest(tenantId, req.body);
    res.status(201).json(atip);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getAtip, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const atip = await getAtipRequest(tenantId, req.params.id);
    res.status(200).json(atip);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as governmentRouter };
