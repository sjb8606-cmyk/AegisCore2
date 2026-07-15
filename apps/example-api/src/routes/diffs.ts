import { Router } from 'express';
import { storeDiff } from '../../../../platform/diff-engine/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', async (req: any, res: any, next: any) => {
  try {
    const result = await storeDiff(req.auth.tenantId, {
      ...req.body,
      actor_id: req.auth.sub
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as diffRouter };
