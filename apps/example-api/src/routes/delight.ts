import { Router } from 'express';
import { processChat } from '../../../../platform/delight/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/chat', async (req: any, res: any, next: any) => {
  try {
    const result = await processChat(req.auth.tenantId, req.body.message, {
      personaId: req.body.personaId,
      blend: req.body.blend,
      humanityLevel: req.body.humanityLevel,
      sessionId: req.body.sessionId
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as delightRouter };
