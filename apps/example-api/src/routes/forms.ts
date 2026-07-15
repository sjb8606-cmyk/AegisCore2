import { Router } from 'express';
import { submitForm } from '../../../../platform/forms/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/:formId/submit', async (req: any, res: any, next: any) => {
  try {
    const result = await submitForm(req.auth.tenantId, req.params.formId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as formsRouter };
