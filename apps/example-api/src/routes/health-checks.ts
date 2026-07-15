import { Router, Request, Response } from 'express';
import { runLivenessCheck, runReadinessCheck, registerHealthCheck, getAggregatedHealth, getHealthLedger, AppError, isValidUuid } from '../../../../platform/health-checks/src/index';

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
    error: msg || 'An unexpected monitoring exception occurred.',
    code: code
  });
}

const paths = {
  live: ['/health', '/api/health-checks/health'],
  ready: ['/health/ready', '/api/health-checks/health/ready'],
  status: ['/health/status', '/api/health-checks/health/status'],
  checks: ['/health/checks', '/api/health-checks/health/checks'],
  ledger: ['/health/checks/:id/ledger', '/api/health-checks/health/checks/:id/ledger']
};

// PUBLIC INFRASTRUCTURE PROBES (Bypasses authentication filters)
router.get(paths.live, async (req: Request, res: Response) => {
  try {
    const result = await runLivenessCheck();
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ready, async (req: Request, res: Response) => {
  try {
    const tenantId = req.header('x-tenant-id') || 'd3b07384-d113-4956-a5e2-4c2de7910001';
    const result = await runReadinessCheck(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

// AUTHENTICATED/TENANT SCOPED PROBES
router.get(paths.status, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await getAggregatedHealth(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.checks, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerHealthCheck(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const definitionId = req.params.id;
    if (!isValidUuid(definitionId)) {
      throw new AppError(`Invalid Definition ID format: '${definitionId}'`, 'BAD_REQUEST');
    }
    const result = await getHealthLedger(tenantId, definitionId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as healthChecksRouter, router as 'health-checksRouter' };
