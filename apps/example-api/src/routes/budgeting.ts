import { Router, Request, Response } from 'express';
import { createBudget, submitBudget, lockBudget, getBudgetDetails, ErrorCode } from '../../../../platform/budgeting/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

// Fixed relative sub-paths to resolve cleanly inside Express's dynamic mounting rules
const paths = {
  create: ['/', '/budgets', '/api/budgeting/budgets'],
  submit: ['/budgets/:id/submit', '/:id/submit'],
  lock: ['/budgets/:id/lock', '/:id/lock'],
  get: ['/budgets/:id', '/:id']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const budget = await createBudget(tenantId, userId, req.body);
    res.status(201).json(budget);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.submit, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await submitBudget(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.lock, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await lockBudget(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getBudgetDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as budgetingRouter };
