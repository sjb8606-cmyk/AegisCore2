import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { VideoService } from '../../../../platform/video/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/sessions', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await VideoService.createSession(req.auth.tenantId, req.body, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:id/record', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await VideoService.startRecording(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/sessions', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await VideoService.fetchSessions(req.auth.tenantId);
    return ok(res, { sessions: result });
  } catch (err) {
    next(err);
  }
});

export default router;
