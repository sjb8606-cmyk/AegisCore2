import { Router } from 'express';
import { createSnapshot } from '../../../../platform/snapshot/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/:type/:id', async (req: any, res: any, next: any) => {
  try {
    const result = await createSnapshot(
      req.auth.tenantId, 
      req.params.type, 
      req.params.id, 
      req.body, 
      req.auth.sub
    );
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as snapshotRouter };
