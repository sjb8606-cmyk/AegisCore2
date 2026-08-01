import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { ProcessingBatchService } from '../../../../platform/fisheries/processing-batch/src/index';

const router = Router();

router.post('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const batch = await ProcessingBatchService.createBatch(tenantId, req.auth.sub, req.body);
    res.status(201).json(batch);
  } catch (err) { next(err); }
});

router.post('/:id/complete', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const batch = await ProcessingBatchService.completeBatch(tenantId, req.params.id, req.auth.sub, req.body);
    res.status(200).json(batch);
  } catch (err) { next(err); }
});

router.post('/:id/cancel', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const batch = await ProcessingBatchService.cancelBatch(tenantId, req.params.id, req.auth.sub);
    res.status(200).json(batch);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const batch = await ProcessingBatchService.getBatch(tenantId, req.params.id);
    res.status(200).json(batch);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { speciesId, status } = req.query;
    const batches = await ProcessingBatchService.listBatches(tenantId, {
      speciesId: speciesId as string | undefined,
      status: status as any,
    });
    res.status(200).json(batches);
  } catch (err) { next(err); }
});

export default router;
