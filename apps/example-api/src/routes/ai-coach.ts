import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { AiCoachService } from '../../../../platform/ai-coach/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/analyze', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AiCoachService.analyzeUserPerformance(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/goals', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AiCoachService.createCoachingGoal(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/recommendations', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AiCoachService.generateRecommendations(req.auth.tenantId, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/goals', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AiCoachService.fetchGoals(req.auth.tenantId, userId);
    return ok(res, { goals: result });
  } catch (err) {
    next(err);
  }
});

export { router as aiCoachRouter };
