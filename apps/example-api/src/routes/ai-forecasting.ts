import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createForecastSeries, runForecast, simulateScenario, detectAnomalies, getForecastLedger, AppError, ErrorCode, isValidUuid } from '../../../../platform/ai-forecasting/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', ErrorCode.UNAUTHORIZED);
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected forecasting intelligence exception occurred.',
    code: code
  });
}

const paths = {
  series: ['/series', '/api/ai-forecasting/series'],
  run: ['/run', '/api/ai-forecasting/run'],
  scenario: ['/scenarios', '/api/ai-forecasting/scenarios'],
  anomalies: ['/anomalies', '/api/ai-forecasting/anomalies'],
  ledger: ['/series/:id/ledger', '/api/ai-forecasting/series/:id/ledger']
};

router.post(paths.series, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createForecastSeries(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.run, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const targetId = req.body.seriesId || req.body.series_id;
    const result = await runForecast(tenantId, targetId, req.body.horizonDays);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.scenario, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await simulateScenario(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.anomalies, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const targetId = req.body.seriesId || req.body.series_id;
    const result = await detectAnomalies(tenantId, targetId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const seriesId = req.params.id;
    if (!isValidUuid(seriesId)) {
      throw new AppError(`Invalid Series ID format: '${seriesId}'`, ErrorCode.BAD_REQUEST);
    }
    const result = await getForecastLedger(tenantId, seriesId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiForecastingRouter };
