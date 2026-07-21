import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createTemplate, generateReport, getReportRun, ErrorCode } from '../../../../platform/ai-reports/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createTemplate: ['/templates', '/api/ai-reports/templates'],
  generate: ['/generate', '/api/ai-reports/generate'],
  getRun: ['/runs/:id', '/api/ai-reports/runs/:id']
};

router.post(paths.createTemplate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const template = await createTemplate(tenantId, req.body);
    res.status(201).json(template);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.generate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const run = await generateReport(tenantId, userId, req.body);
    res.status(201).json(run);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getRun, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const run = await getReportRun(tenantId, req.params.id);
    res.status(200).json(run);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as aiReportsRouter };
