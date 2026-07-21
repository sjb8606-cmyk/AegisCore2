import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createExpenseReport, submitExpenseReport, approveExpenseReport, getExpenseDetails, ErrorCode } from '../../../../platform/expenses/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

// Map base '/' path to avoid routing mounting 404s
const paths = {
  create: ['/', '/reports', '/api/expenses/reports'],
  submit: ['/:id/submit', '/api/expenses/reports/:id/submit'],
  approve: ['/:id/approve', '/api/expenses/reports/:id/approve'],
  get: ['/:id', '/api/expenses/reports/:id']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const report = await createExpenseReport(tenantId, userId, req.body);
    res.status(201).json(report);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.submit, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await submitExpenseReport(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.approve, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await approveExpenseReport(tenantId, req.params.id, userId, req.body.reason);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getExpenseDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as expensesRouter };
