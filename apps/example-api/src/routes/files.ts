import { Router } from 'express';
import { requestFileUpload } from '../../../../platform/files/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/upload-request', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await requestFileUpload(
      req.auth.tenantId, 
      req.body.filename, 
      req.body.sizeBytes, 
      req.auth.sub
    );
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as filesRouter };
