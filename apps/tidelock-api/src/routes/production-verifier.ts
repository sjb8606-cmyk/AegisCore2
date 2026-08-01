import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { ProductionVerifierService } from '../../../../platform/fisheries/production-verifier/src/index';
import { ProcessingBatchService } from '../../../../platform/fisheries/processing-batch/src/index';
import { YieldEngineService } from '../../../../platform/fisheries/yield-engine/src/index';

const router = Router();

router.post('/batch/:batchId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const batch = await ProcessingBatchService.getBatch(tenantId, req.params.batchId);
    const event = await ProductionVerifierService.recordBatchCompletion(tenantId, req.auth.sub, batch);
    res.status(201).json(event);
  } catch (err) { next(err); }
});

router.post('/yield/:yieldRecordId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const yieldRecord = await YieldEngineService.getYieldForBatch(tenantId, req.params.yieldRecordId);
    const event = await ProductionVerifierService.recordYieldComputation(tenantId, req.auth.sub, yieldRecord);
    res.status(201).json(event);
  } catch (err) { next(err); }
});

router.post('/integrity', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await ProductionVerifierService.verifyProductionIntegrity(tenantId);
    res.status(200).json(result);
  } catch (err) { next(err); }
});

router.get('/history', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const history = await ProductionVerifierService.getVerificationHistory(tenantId);
    res.status(200).json(history);
  } catch (err) { next(err); }
});

export default router;
