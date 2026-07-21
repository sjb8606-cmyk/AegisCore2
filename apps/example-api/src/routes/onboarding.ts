import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createFlow, startFlow, completeStep, ErrorCode } from '../../../../platform/onboarding/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createFlow: ['/flows', '/api/onboarding/flows'],
  startFlow: ['/me/start/:flowId', '/api/onboarding/me/start/:flowId'],
  completeStep: ['/me/step/:stepId/complete', '/api/onboarding/me/step/:stepId/complete']
};

router.post(paths.createFlow, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const flow = await createFlow(tenantId, userId, req.body);
    res.status(201).json(flow);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.startFlow, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const progress = await startFlow(tenantId, userId, req.params.flowId);
    res.status(201).json(progress);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.completeStep, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const progress = await completeStep(tenantId, userId, parseInt(req.params.stepId, 10));
    res.status(200).json(progress);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as onboardingRouter };
