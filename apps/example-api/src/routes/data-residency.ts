import { Router, Request, Response } from 'express';
import { createRegion, setResidencyPolicy, enforceResidencyGate, getResidencyLedger, AppError } from '../../../../platform/data-residency/src/index';

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
    error: msg || 'An unexpected data residency exception occurred.',
    code: code
  });
}

const paths = {
  region: ['/regions', '/api/data-residency/regions'],
  policy: ['/policy', '/api/data-residency/policy'],
  check: ['/check', '/api/data-residency/check'],
  ledger: ['/ledger', '/api/data-residency/ledger']
};

router.post(paths.region, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createRegion(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.put(paths.policy, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await setResidencyPolicy(tenantId, req.body, userId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.check, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const clientRegion = String(req.header('x-region') || 'US');
    const result = await enforceResidencyGate(tenantId, clientRegion);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await getResidencyLedger(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as dataResidencyRouter, router as 'data-residencyRouter' };
