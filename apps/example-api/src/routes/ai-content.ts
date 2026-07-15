import { Router, Request, Response } from 'express';
import { generateContent, generateVariants, getContentLedger, AppError, isValidUuid } from '../../../../platform/ai-content/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw new AppError('Missing x-tenant-id', 'BAD_REQUEST');
  return { tenantId, userId };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected content generation exception occurred.',
    code: code
  });
}

const paths = {
  generate: ['/generate', '/api/ai-content/generate'],
  variants: ['/variants', '/api/ai-content/variants'],
  ledger: ['/assets/:id/ledger', '/api/ai-content/assets/:id/ledger']
};

router.post(paths.generate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await generateContent(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.variants, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const targetId = req.body.contentId || req.body.content_id;
    const result = await generateVariants(tenantId, targetId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const assetId = req.params.id;
    if (!isValidUuid(assetId)) {
      throw new AppError(`Invalid Asset ID format: '${assetId}'`, 'BAD_REQUEST');
    }
    const result = await getContentLedger(tenantId, assetId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiContentRouter, router as 'ai-contentRouter' };
