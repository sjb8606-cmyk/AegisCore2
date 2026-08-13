import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { RecallEngineService } from '../../../../platform/recall-engine/src/index';

const router = Router();

router.get('/:lotId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const report = await RecallEngineService.generateRecallReport(tenantId, req.params.lotId);
    res.status(200).json(report);
  } catch (err) { next(err); }
});

router.post('/:lotId/hold', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const report = await RecallEngineService.cascadeHold(tenantId, req.auth.sub, req.params.lotId, req.body);
    res.status(200).json(report);
  } catch (err) { next(err); }
});

export default router;
