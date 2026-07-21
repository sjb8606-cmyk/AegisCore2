import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { translateText, addGlossaryTerm, translateStructuredData, getTranslationLedger, AppError, isValidUuid } from '../../../../platform/ai-translation/src/index';

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
    error: msg || 'An unexpected translation intelligence exception occurred.',
    code: code
  });
}

const paths = {
  translate: ['/translate', '/api/ai-translation/translate'],
  glossary: ['/glossary', '/api/ai-translation/glossary'],
  structured: ['/structured', '/api/ai-translation/structured'],
  ledger: ['/jobs/:id/ledger', '/api/ai-translation/jobs/:id/ledger']
};

router.post(paths.translate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await translateText(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.glossary, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await addGlossaryTerm(tenantId, req.body.term, req.body.translation, req.body.language);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.structured, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await translateStructuredData(tenantId, req.body.data, req.body.target_language);
    res.status(200).json({ translated: result });
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const jobId = req.params.id;
    if (!isValidUuid(jobId)) {
      throw new AppError(`Invalid Job ID format: '${jobId}'`, 'BAD_REQUEST');
    }
    const result = await getTranslationLedger(tenantId, jobId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiTranslationRouter };
