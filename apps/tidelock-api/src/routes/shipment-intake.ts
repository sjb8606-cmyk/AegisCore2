import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { ShipmentIntakeService } from '../../../../platform/fisheries/shipment-intake/src/index';

const router = Router();

router.post('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shipment = await ShipmentIntakeService.logShipment(tenantId, req.auth.sub, req.body);
    res.status(201).json(shipment);
  } catch (err) { next(err); }
});

router.get('/total-weight', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { speciesId, fromDate, toDate } = req.query;
    const total = await ShipmentIntakeService.getTotalWeightForSpecies(tenantId, speciesId as string, {
      fromDate: fromDate as string | undefined,
      toDate: toDate as string | undefined,
    });
    res.status(200).json({ speciesId, totalWeightKg: total });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shipment = await ShipmentIntakeService.getShipment(tenantId, req.params.id);
    res.status(200).json(shipment);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { speciesId, fromDate, toDate } = req.query;
    const shipments = await ShipmentIntakeService.listShipments(tenantId, {
      speciesId: speciesId as string | undefined,
      fromDate: fromDate as string | undefined,
      toDate: toDate as string | undefined,
    });
    res.status(200).json(shipments);
  } catch (err) { next(err); }
});

export default router;
