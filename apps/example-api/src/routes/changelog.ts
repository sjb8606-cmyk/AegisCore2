import { Router } from 'express';
import { getTimeline } from '../../../../platform/changelog/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.get('/:type/:id', async (req: any, res: any, next: any) => {
  try {
    const result = await getTimeline(req.auth.tenantId, req.params.type, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as changelogRouter };
