import { Router } from 'express';
import { trackEvent, getFunnel } from '../../../../platform/analytics/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/events', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await trackEvent(req.auth.tenantId, req.body.name, req.body.properties);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/funnel', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await getFunnel(req.auth.tenantId, req.query.steps ? String(req.query.steps).split(',') : []);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as analyticsRouter };
