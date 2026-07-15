import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { SchedulingService } from '../../../../platform/scheduling/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/appointments', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await SchedulingService.createAppointment(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/appointments', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SchedulingService.fetchAppointments(req.auth.tenantId);
    return ok(res, { appointments: result });
  } catch (err) {
    next(err);
  }
});

export { router as schedulingRouter };
