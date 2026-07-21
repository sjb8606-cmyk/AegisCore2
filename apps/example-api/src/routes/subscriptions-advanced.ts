import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createPlan, createSubscription, recordUsage, getEntitlementStatus, AppError, isValidUuid } from '../../../../platform/subscriptions-advanced/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'PAYMENT_REQUIRED' ? 402 : (code === 'BAD_REQUEST' ? 400 : 500);
  
  res.status(status).json({ 
    error: msg || 'An unexpected internal error occurred.',
    code: code
  });
}

const paths = {
  createPlan: ['/plans', '/api/subscriptions-advanced/plans'],
  subscribe: ['/subscriptions', '/api/subscriptions-advanced/subscriptions'],
  usage: ['/subscriptions/:id/usage', '/api/subscriptions-advanced/subscriptions/:id/usage'],
  entitlements: ['/subscriptions/:id/entitlements/:metric', '/api/subscriptions-advanced/subscriptions/:id/entitlements/:metric']
};

router.post(paths.createPlan, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const plan = await createPlan(tenantId, req.body);
    res.status(201).json(plan);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.subscribe, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const sub = await createSubscription(tenantId, userId, req.body.plan_id);
    res.status(201).json(sub);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.usage, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const subId = req.params.id;
    if (!isValidUuid(subId)) {
      throw new AppError(`Invalid subscription ID: '${subId}'. Check that your verification script variables are populated correctly.`, 'BAD_REQUEST');
    }
    const usage = await recordUsage(tenantId, subId, req.body, userId);
    res.status(201).json(usage);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.entitlements, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const subId = req.params.id;
    if (!isValidUuid(subId)) {
      throw new AppError(`Invalid subscription ID: '${subId}'.`, 'BAD_REQUEST');
    }
    const status = await getEntitlementStatus(tenantId, subId, req.params.metric);
    res.status(200).json(status);
  } catch (error: any) { handleError(res, error); }
});

export { router as subscriptionsAdvancedRouter };
