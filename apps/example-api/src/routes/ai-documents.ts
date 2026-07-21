import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { submitAnalysis, getAnalysisDetails, ErrorCode } from '../../../../platform/ai-documents/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  submit: ['/analyses', '/api/ai-documents/analyses'],
  getAnalysis: ['/analyses/:id', '/api/ai-documents/analyses/:id']
};

router.post(paths.submit, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const analysis = await submitAnalysis(tenantId, userId, req.body);
    res.status(201).json(analysis);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getAnalysis, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getAnalysisDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as aiDocumentsRouter };
