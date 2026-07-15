import { Router } from 'express';
import { createContact } from '../../../../platform/crm/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/contacts', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await createContact(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as crmRouter };
