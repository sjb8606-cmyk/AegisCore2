import { Router } from 'express';
import { createSandboxSession, captureRequest } from '../../../../platform/sandbox/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

// 1. Create Session
router.post('/sessions', async (req: any, res: any, next: any) => {
  try {
    const result = await createSandboxSession(req.auth.tenantId, req.auth.sub);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// 2. Capture Request
router.post('/sessions/:id/capture', async (req: any, res: any, next: any) => {
  try {
    const result = await captureRequest(req.params.id, req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as sandboxRouter };
