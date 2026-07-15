import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { SmsCampaignsService } from '../../../../platform/sms-campaigns/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SmsCampaignsService.createCampaign(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/send', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SmsCampaignsService.sendCampaign(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/opt-out', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const tenantId = req.body.tenantId || req.auth.tenantId;
    const result = await SmsCampaignsService.registerOptOut(tenantId, req.body.phone_number, req.body.reason);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SmsCampaignsService.fetchCampaigns(req.auth.tenantId);
    return ok(res, { campaigns: result });
  } catch (err) {
    next(err);
  }
});

export { router as smsCampaignsRouter };
