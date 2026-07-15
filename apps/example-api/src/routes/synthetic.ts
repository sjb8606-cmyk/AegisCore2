import { Router } from 'express';
import { generateMirage } from '../../../../platform/synthetic/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/generate', async (req: any, res: any, next: any) => {
  try {
    const result = await generateMirage(
      req.auth.tenantId, 
      req.body.type, 
      req.body.count, 
      req.body.sandboxId
    );
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as syntheticRouter };
