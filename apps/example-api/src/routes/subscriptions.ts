import { Router } from 'express';
import { createPlan, createSubscription } from '../../../../platform/subscriptions/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/plans', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await createPlan(req.auth.tenantId, req.body.name, req.body.priceCents);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/subscribe', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await createSubscription(req.auth.tenantId, req.auth.sub, req.body.planId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as subRouter };
