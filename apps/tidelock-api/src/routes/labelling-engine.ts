import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { LabellingEngineService } from '../../../../platform/fisheries/labelling-engine/src/index';

const router = Router();

router.post('/rules', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const rules = await LabellingEngineService.setMarketRules(tenantId, req.auth.sub, req.body);
    res.status(201).json(rules);
  } catch (err) { next(err); }
});

router.get('/rules/:market', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const rules = await LabellingEngineService.getMarketRules(tenantId, req.params.market);
    res.status(200).json(rules);
  } catch (err) { next(err); }
});

router.post('/:lotId/generate', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await LabellingEngineService.generateLabel(tenantId, req.auth.sub, req.params.lotId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/:lotId/labels', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const labels = await LabellingEngineService.listLabelsForLot(tenantId, req.params.lotId);
    res.status(200).json(labels);
  } catch (err) { next(err); }
});

router.get('/labels/:labelId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const label = await LabellingEngineService.getLabel(tenantId, req.params.labelId);
    res.status(200).json(label);
  } catch (err) { next(err); }
});

export default router;
