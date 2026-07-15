import { Router } from 'express';
import { runScenario } from '../../../../platform/scenarios/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/run', async (req: any, res: any, next: any) => {
  try {
    const result = await runScenario(req.auth.tenantId, req.body.name, req.body.steps);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as scenarioRouter };
