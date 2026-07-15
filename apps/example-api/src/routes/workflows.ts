import { Router } from 'express';
import { createWorkflow, triggerWorkflow } from '../../../../platform/workflows/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await createWorkflow(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/trigger', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await triggerWorkflow(req.auth.tenantId, req.params.id, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as workflowsRouter };
