import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { DataGovernanceService } from '../../../../platform/data-governance/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/classify', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await DataGovernanceService.classifyDataAsset(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/access-log', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await DataGovernanceService.recordAccess(
      req.auth.tenantId, 
      req.auth.userId, 
      req.body.assetId, 
      req.body.action
    );
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/assets', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await DataGovernanceService.fetchAssets(req.auth.tenantId);
    return ok(res, { assets: result });
  } catch (err) {
    next(err);
  }
});

export { router as dataGovernanceRouter };
