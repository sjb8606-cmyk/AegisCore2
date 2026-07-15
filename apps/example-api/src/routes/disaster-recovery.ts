import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { DisasterRecoveryService } from '../../../../platform/disaster-recovery/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/failover', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await DisasterRecoveryService.triggerFailover(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/events', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await DisasterRecoveryService.fetchEvents(req.auth.tenantId);
    return ok(res, { events: result });
  } catch (err) {
    next(err);
  }
});

export { router as disasterRecoveryRouter };
