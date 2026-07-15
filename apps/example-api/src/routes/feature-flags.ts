import { Router, Request, Response } from 'express';
import { createFlag, evaluateFlag, AppError } from '../../../../platform/feature-flags/src/index';

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
    error: msg || 'An unexpected feature flags exception occurred.',
    code: code
  });
}

const paths = {
  create: ['/flags', '/api/feature-flags/flags'],
  evaluate: ['/evaluate', '/api/feature-flags/evaluate']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createFlag(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.evaluate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await evaluateFlag(tenantId, req.body);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as featureFlagsRouter, router as 'feature-flagsRouter' };
