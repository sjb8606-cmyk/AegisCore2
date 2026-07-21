import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createModel, evaluate, overrideDecision, getDecisionDetails, ErrorCode } from '../../../../platform/ai-decisions/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createModel: ['/models', '/api/ai-decisions/models'],
  evaluate: ['/evaluate', '/api/ai-decisions/evaluate'],
  getDecision: ['/decisions/:id', '/api/ai-decisions/decisions/:id'],
  override: ['/decisions/:id/override', '/api/ai-decisions/decisions/:id/override']
};

router.post(paths.createModel, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const model = await createModel(tenantId, req.body);
    res.status(201).json(model);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.evaluate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const decision = await evaluate(tenantId, userId, req.body);
    res.status(201).json(decision);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getDecision, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getDecisionDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.override, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await overrideDecision(tenantId, req.params.id, req.body.newOutcome, req.body.reason, userId);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as aiDecisionsRouter };
