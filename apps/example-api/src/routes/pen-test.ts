import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { PenTestService } from '../../../../platform/pen-test/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/scan', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await PenTestService.runSecurityScan(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/scans', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await PenTestService.fetchScans(req.auth.tenantId);
    return ok(res, { scans: result });
  } catch (err) {
    next(err);
  }
});

export { router as penTestRouter };
