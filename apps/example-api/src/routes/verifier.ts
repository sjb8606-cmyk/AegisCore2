import { Router } from 'express';
import { runIntegrityCheck } from '../../../../platform/verifier/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/verify', async (req: any, res: any, next: any) => {
  try {
    const result = await runIntegrityCheck(req.auth.tenantId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as verifierRouter };
