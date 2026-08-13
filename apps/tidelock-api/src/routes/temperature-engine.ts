import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { TemperatureEngineService } from '../../../../platform/fisheries/temperature-engine/src/index';

const router = Router();

router.post('/threshold', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const threshold = await TemperatureEngineService.setThreshold(tenantId, req.auth.sub, req.body);
    res.status(201).json(threshold);
  } catch (err) { next(err); }
});

router.post('/:lotId/reading', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await TemperatureEngineService.logReading(tenantId, req.auth.sub, req.params.lotId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/:lotId/readings', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const readings = await TemperatureEngineService.getReadingsForLot(tenantId, req.params.lotId);
    res.status(200).json(readings);
  } catch (err) { next(err); }
});

export default router;
