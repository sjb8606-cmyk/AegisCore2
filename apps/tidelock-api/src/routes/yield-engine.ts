import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { YieldEngineService } from '../../../../platform/fisheries/yield-engine/src/index';

const router = Router();

router.post('/:batchId/compute', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await YieldEngineService.computeYield(tenantId, req.params.batchId, req.auth.sub);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

router.get('/batch/:batchId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await YieldEngineService.getYieldForBatch(tenantId, req.params.batchId);
    res.status(200).json(record);
  } catch (err) { next(err); }
});

router.get('/average/:speciesId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const avg = await YieldEngineService.getAverageYieldForSpecies(tenantId, req.params.speciesId);
    res.status(200).json({ speciesId: req.params.speciesId, averageYieldPercent: avg });
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { speciesId, underperformingOnly } = req.query;
    const records = await YieldEngineService.listYieldRecords(tenantId, {
      speciesId: speciesId as string | undefined,
      underperformingOnly: underperformingOnly === 'true',
    });
    res.status(200).json(records);
  } catch (err) { next(err); }
});

export default router;
