import { Router } from 'express';
import { submitDataRequest } from '../../../../platform/compliance/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/requests', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await submitDataRequest(req.auth.tenantId, req.auth.sub, req.body.requestType);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as complianceRouter };
