import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createMaintenanceWindow, addBypassEntry, evaluateRequestGate, getMaintenanceLedger, AppError, isValidUuid } from '../../../../platform/maintenance-mode/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'SERVICE_UNAVAILABLE' ? 503 : (code === 'BAD_REQUEST' ? 400 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected maintenance exception occurred.',
    code: code
  });
}

const paths = {
  window: ['/windows', '/api/maintenance-mode/windows'],
  bypass: ['/windows/:id/bypass', '/api/maintenance-mode/windows/:id/bypass'],
  gate: ['/gate', '/api/maintenance-mode/gate'],
  ledger: ['/windows/:id/ledger', '/api/maintenance-mode/windows/:id/ledger']
};

router.post(paths.window, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createMaintenanceWindow(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.bypass, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const windowId = req.params.id;
    if (!isValidUuid(windowId)) {
      throw new AppError(`Invalid Window ID format: '${windowId}'`, 'BAD_REQUEST');
    }
    const result = await addBypassEntry(tenantId, windowId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.gate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const role = String(req.query.role || 'guest');
    const ip = String(req.query.ip || '127.0.0.1');

    const result = await evaluateRequestGate(tenantId, userId, role, ip);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const windowId = req.params.id;
    if (!isValidUuid(windowId)) {
      throw new AppError(`Invalid Window ID format: '${windowId}'`, 'BAD_REQUEST');
    }
    const result = await getMaintenanceLedger(tenantId, windowId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as maintenanceModeRouter };
