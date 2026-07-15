import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { EmailMarketingService } from '../../../../platform/email-marketing/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await EmailMarketingService.createCampaign(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/send', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await EmailMarketingService.sendCampaign(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/unsubscribe', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const tenantId = req.body.tenantId || req.auth.tenantId;
    const result = await EmailMarketingService.registerUnsubscribe(tenantId, req.body.email, req.body.reason);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await EmailMarketingService.fetchCampaigns(req.auth.tenantId);
    return ok(res, { campaigns: result });
  } catch (err) {
    next(err);
  }
});

export { router as emailMarketingRouter };
