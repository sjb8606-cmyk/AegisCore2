import { Router } from 'express';
import { translateToPlainLanguage } from '../../../../platform/translator/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/translate', async (req: any, res: any, next: any) => {
  try {
    const result = await translateToPlainLanguage(req.auth.tenantId, req.body.text, req.body.level);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as translatorRouter };
