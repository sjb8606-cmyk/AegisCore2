import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { HrService } from '../../../../platform/hr/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/employees', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await HrService.createEmployee(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/employees/:id/clock', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await HrService.clockIn(req.auth.tenantId, req.params.id, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/employees', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await HrService.fetchEmployees(req.auth.tenantId);
    return ok(res, { employees: result });
  } catch (err) {
    next(err);
  }
});

export { router as hrRouter };
