import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createShipment, updateDriverLocation, getPublicTracking, ErrorCode } from '../../../../platform/logistics/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createShipment: ['/shipments', '/api/logistics/shipments'],
  updateLocation: ['/drivers/:driverId/location', '/api/logistics/drivers/:driverId/location'],
  track: ['/track/:token', '/api/logistics/track/:token']
};

router.post(paths.createShipment, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const shipment = await createShipment(tenantId, userId, req.body);
    res.status(201).json(shipment);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.updateLocation, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const location = await updateDriverLocation(tenantId, req.params.driverId, req.body.lat, req.body.lon);
    res.status(201).json(location);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.track, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tracking = await getPublicTracking(tenantId, req.params.token);
    res.status(200).json(tracking);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as logisticsRouter };
