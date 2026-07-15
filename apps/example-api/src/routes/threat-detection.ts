import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ThreatDetectionService } from '../../../../platform/threat-detection/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/event', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await ThreatDetectionService.ingestThreatEvent(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/events', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await ThreatDetectionService.fetchEvents(req.auth.tenantId);
    return ok(res, { events: result });
  } catch (err) {
    next(err);
  }
});

export { router as threatDetectionRouter };
