import { Router, Request, Response } from 'express';
import { registerDevice, ingestAnalyticsEvents, getDeviceLedger, AppError, isValidUuid } from '../../../../platform/mobile-api/src/index';

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
    error: msg || 'An unexpected mobile API exceptions occurred.',
    code: code
  });
}

const paths = {
  register: ['/devices', '/api/mobile-api/devices'],
  analytics: ['/analytics/events', '/api/mobile-api/analytics/events'],
  ledger: ['/devices/:id/ledger', '/api/mobile-api/devices/:id/ledger']
};

router.post(paths.register, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await registerDevice(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.analytics, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await ingestAnalyticsEvents(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const deviceId = req.params.id;
    if (!isValidUuid(deviceId)) {
      throw new AppError(`Invalid Device ID format: '${deviceId}'`, 'BAD_REQUEST');
    }
    const result = await getDeviceLedger(tenantId, deviceId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as mobileApiRouter, router as 'mobile-apiRouter' };
