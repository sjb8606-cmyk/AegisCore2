import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { HoldReleaseService } from '../../../../platform/fisheries/hold-release/src/index';

const router = Router();

router.post('/:lotId/investigate', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await HoldReleaseService.openInvestigation(tenantId, req.auth.sub, req.params.lotId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/investigations/:investigationId/resolve', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await HoldReleaseService.resolveInvestigation(
      tenantId, req.auth.sub, req.params.investigationId, req.body,
    );
    res.status(200).json(result);
  } catch (err) { next(err); }
});

router.get('/investigations/:investigationId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const investigation = await HoldReleaseService.getInvestigation(tenantId, req.params.investigationId);
    res.status(200).json(investigation);
  } catch (err) { next(err); }
});

router.get('/investigations', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const investigations = await HoldReleaseService.listOpenInvestigations(tenantId);
    res.status(200).json(investigations);
  } catch (err) { next(err); }
});

export default router;
