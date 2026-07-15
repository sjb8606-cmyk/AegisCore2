import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { LiveChatService } from '../../../../platform/live-chat/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/conversations', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await LiveChatService.createConversation(req.auth.tenantId, req.body, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/messages', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await LiveChatService.sendMessage(req.auth.tenantId, req.body, userId, 'user');
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await LiveChatService.fetchConversations(req.auth.tenantId);
    return ok(res, { conversations: result });
  } catch (err) {
    next(err);
  }
});

export default router;
