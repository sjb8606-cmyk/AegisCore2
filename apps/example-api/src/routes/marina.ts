import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createSlip, registerVessel, reserveBerth, logFuelUsage, getMarinaLedger, AppError, isValidUuid } from '../../../../platform/marina/src/index';

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
    error: msg || 'An unexpected marina exception occurred.',
    code: code
  });
}

const paths = {
  slip: ['/slips', '/api/marina/slips'],
  vessel: ['/vessels', '/api/marina/vessels'],
  reserve: ['/reservations', '/api/marina/reservations'],
  fuel: ['/fuel', '/api/marina/fuel'],
  ledger: ['/slips/:id/ledger', '/api/marina/slips/:id/ledger']
};

router.post(paths.slip, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createSlip(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.vessel, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerVessel(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.reserve, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await reserveBerth(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.fuel, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await logFuelUsage(tenantId, req.body, userId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const slipId = req.params.id;
    if (!isValidUuid(slipId)) {
      throw new AppError(`Invalid Slip ID format: '${slipId}'`, 'BAD_REQUEST');
    }
    const result = await getMarinaLedger(tenantId, slipId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as marinaRouter };
