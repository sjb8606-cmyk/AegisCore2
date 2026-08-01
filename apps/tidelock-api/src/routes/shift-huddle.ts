import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { ShiftHuddleService } from '../../../../platform/fisheries/shift-huddle/src/index';

const router = Router();

router.post('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shift = await ShiftHuddleService.startShift(tenantId, req.auth.sub, req.body);
    res.status(201).json(shift);
  } catch (err) { next(err); }
});

router.post('/:id/end', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shift = await ShiftHuddleService.endShift(tenantId, req.params.id, req.auth.sub, req.body);
    res.status(200).json(shift);
  } catch (err) { next(err); }
});

router.get('/active/:shiftType', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shift = await ShiftHuddleService.getActiveShift(tenantId, req.params.shiftType as any);
    res.status(200).json(shift);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const shift = await ShiftHuddleService.getShift(tenantId, req.params.id);
    res.status(200).json(shift);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const { shiftType, status } = req.query;
    const shifts = await ShiftHuddleService.listShifts(tenantId, {
      shiftType: shiftType as any,
      status: status as any,
    });
    res.status(200).json(shifts);
  } catch (err) { next(err); }
});

export default router;
