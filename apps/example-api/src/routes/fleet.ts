import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createVehicle, assignDriver, scheduleMaintenance, getVehicleDetails, ErrorCode } from '../../../../platform/fleet/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

// Aligned relative paths to append correctly to the auto-discovered '/api/fleet' prefix
const paths = {
  create: ['/', '/vehicles'],
  assign: ['/vehicles/:id/assign', '/:id/assign'],
  maintenance: ['/vehicles/:id/maintenance', '/:id/maintenance'],
  get: ['/vehicles/:id', '/:id']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const vehicle = await createVehicle(tenantId, userId, req.body);
    res.status(201).json(vehicle);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.assign, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await assignDriver(tenantId, req.params.id, req.body.driverId, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.maintenance, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await scheduleMaintenance(tenantId, req.params.id, req.body);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getVehicleDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as fleetRouter };
