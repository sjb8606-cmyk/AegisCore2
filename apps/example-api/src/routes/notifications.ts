import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { NotificationService } from '../../../../platform/notifications/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await NotificationService.send(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const logs = await NotificationService.fetchLogs(req.auth.tenantId);
    return ok(res, { logs });
  } catch (err) {
    next(err);
  }
});

export { router as notificationsRouter };
