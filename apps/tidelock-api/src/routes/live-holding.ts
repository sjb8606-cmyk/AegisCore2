import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { LiveHoldingService } from '../../../../platform/fisheries/live-holding/src/index';

const router = Router();

router.post('/tanks', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const tank = await LiveHoldingService.registerTank(tenantId, req.auth.sub, req.body);
    res.status(201).json(tank);
  } catch (err) { next(err); }
});

router.get('/tanks', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const tanks = await LiveHoldingService.listTanks(tenantId);
    res.status(200).json(tanks);
  } catch (err) { next(err); }
});

router.post('/lots/:lotId/place', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await LiveHoldingService.placeLot(tenantId, req.auth.sub, req.params.lotId, req.body);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

router.get('/records', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const records = await LiveHoldingService.listActiveHoldings(tenantId);
    res.status(200).json(records);
  } catch (err) { next(err); }
});

router.get('/records/:recordId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await LiveHoldingService.getHoldingRecord(tenantId, req.params.recordId);
    res.status(200).json(record);
  } catch (err) { next(err); }
});

router.get('/records/:recordId/history', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const history = await LiveHoldingService.getHoldingHistory(tenantId, req.params.recordId);
    res.status(200).json(history);
  } catch (err) { next(err); }
});

router.post('/records/:recordId/mortality', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await LiveHoldingService.recordMortality(tenantId, req.auth.sub, req.params.recordId, req.body);
    res.status(200).json(record);
  } catch (err) { next(err); }
});

router.post('/records/:recordId/transfer', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await LiveHoldingService.transfer(tenantId, req.auth.sub, req.params.recordId, req.body);
    res.status(200).json(record);
  } catch (err) { next(err); }
});

router.post('/records/:recordId/remove', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const record = await LiveHoldingService.remove(tenantId, req.auth.sub, req.params.recordId, req.body);
    res.status(200).json(record);
  } catch (err) { next(err); }
});

export default router;
