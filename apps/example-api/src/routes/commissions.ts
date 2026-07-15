import { Router, Request, Response } from 'express';
import { createCommissionPlan, createCommissionRule, calculateCommissions, processPayoutBatch, getCommissionsLogs, ErrorCode } from '../../../../platform/commissions/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

// Fixed relative sub-paths to resolve cleanly inside Express's dynamic mounting rules
const paths = {
  createPlan: ['/plans', '/api/commissions/plans'],
  createRule: ['/rules', '/api/commissions/rules'],
  calculate: ['/calculate', '/api/commissions/calculate'],
  payout: ['/payouts/batch', '/api/commissions/payouts/batch'],
  getLogs: ['/transactions/:id/logs', '/api/commissions/transactions/:id/logs']
};

router.post(paths.createPlan, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const plan = await createCommissionPlan(tenantId, userId, req.body);
    res.status(201).json(plan);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createRule, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const rule = await createCommissionRule(tenantId, req.body.planId, req.body);
    res.status(201).json(rule);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.calculate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const results = await calculateCommissions(tenantId, req.body);
    res.status(201).json(results);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.payout, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await processPayoutBatch(tenantId, req.body.batchId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getLogs, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const logs = await getCommissionsLogs(tenantId, req.params.id);
    res.status(200).json(logs);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as commissionsRouter };
