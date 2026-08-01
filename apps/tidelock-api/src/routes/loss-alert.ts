import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { LossAlertService } from '../../../../platform/fisheries/loss-alert/src/index';

const router = Router();

router.post('/:yieldRecordId/send', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const alert = await LossAlertService.sendLossAlert(tenantId, req.params.yieldRecordId, req.auth.sub);
    res.status(201).json(alert);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { speciesId } = req.query;
    const alerts = await LossAlertService.listAlerts(tenantId, { speciesId: speciesId as string | undefined });
    res.status(200).json(alerts);
  } catch (err) { next(err); }
});

export default router;
