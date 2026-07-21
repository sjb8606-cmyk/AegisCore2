import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createReport, runReport, getReportRun, getExecutiveDashboard, ErrorCode } from '../../../../platform/reporting/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createReport: ['/reports', '/api/reporting/reports'],
  runReport: ['/reports/:id/run', '/api/reporting/reports/:id/run'],
  getRun: ['/runs/:runId', '/api/reporting/runs/:runId'],
  dashboard: ['/dashboard', '/api/reporting/dashboard']
};

router.post(paths.createReport, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const report = await createReport(tenantId, userId, req.body);
    res.status(201).json(report);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.runReport, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const runResult = await runReport(tenantId, req.params.id, userId);
    res.status(201).json(runResult);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getRun, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const run = await getReportRun(tenantId, req.params.runId);
    res.status(200).json(run);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.get(paths.dashboard, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const dashboard = await getExecutiveDashboard(tenantId);
    res.status(200).json(dashboard);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as reportingRouter };
