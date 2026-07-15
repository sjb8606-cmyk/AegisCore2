import { Router, Request, Response } from 'express';
import { submitAnalysis, getAnalysisDetails, ErrorCode } from '../../../../platform/ai-documents/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
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
