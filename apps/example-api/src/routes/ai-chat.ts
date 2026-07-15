import { Router } from 'express';
import { startConversation, sendMessage } from '../../../../platform/ai-chat/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

// Create new session
router.post('/sessions', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await startConversation(req.auth.tenantId, req.auth.sub);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// Send message
router.post('/sessions/:id/messages', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await sendMessage(req.auth.tenantId, req.params.id, req.body.message, req.auth.sub);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as aiRouter };
