import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { FeedbackService } from '../../../../platform/feedback/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await FeedbackService.submitFeedback(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/vote', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await FeedbackService.voteFeedback(req.auth.tenantId, userId, {
      feedback_id: req.params.id,
      vote: 1
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await FeedbackService.fetchFeedback(req.auth.tenantId);
    return ok(res, { feedback: result });
  } catch (err) {
    next(err);
  }
});

export { router as feedbackRouter };
