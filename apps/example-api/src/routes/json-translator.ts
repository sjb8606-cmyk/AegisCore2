import { Router } from 'express';
import { processJsonForInsight } from '../../../../platform/json-translator/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/inspect', async (req: any, res: any, next: any) => {
  try {
    const result = await processJsonForInsight(req.auth.tenantId, req.body.payload);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as jsonRouter };
