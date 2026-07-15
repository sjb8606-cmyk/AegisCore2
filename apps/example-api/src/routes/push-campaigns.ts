import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { PushCampaignsService } from '../../../../platform/push-campaigns/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/devices', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await PushCampaignsService.registerDevice(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await PushCampaignsService.createCampaign(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/send', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await PushCampaignsService.sendCampaign(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await PushCampaignsService.fetchCampaigns(req.auth.tenantId);
    return ok(res, { campaigns: result });
  } catch (err) {
    next(err);
  }
});

export { router as pushCampaignsRouter };
