import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createRoute, createTrip, bookSeat, updateTripStatus, getTripLedger, AppError, isValidUuid } from '../../../../platform/transport/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected transport exception occurred.',
    code: code
  });
}

const paths = {
  route: ['/routes', '/api/transport/routes'],
  trip: ['/trips', '/api/transport/trips'],
  book: ['/bookings', '/api/transport/bookings'],
  status: ['/trips/:id/status', '/api/transport/trips/:id/status'],
  ledger: ['/trips/:id/ledger', '/api/transport/trips/:id/ledger']
};

router.post(paths.route, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createRoute(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.trip, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createTrip(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.book, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await bookSeat(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.status, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tripId = req.params.id;
    if (!isValidUuid(tripId)) {
      throw new AppError(`Invalid Trip ID format: '${tripId}'`, 'BAD_REQUEST');
    }
    const result = await updateTripStatus(tenantId, tripId, req.body.status);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tripId = req.params.id;
    if (!isValidUuid(tripId)) {
      throw new AppError(`Invalid Trip ID format: '${tripId}'`, 'BAD_REQUEST');
    }
    const result = await getTripLedger(tenantId, tripId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as transportRouter };
