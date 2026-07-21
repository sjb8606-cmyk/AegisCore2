import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createRoom, getAvailableRooms, createReservation, checkOut, ErrorCode } from '../../../../platform/hospitality/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

// Corrected relative paths to append properly to the Auto-Discovery prefix
const paths = {
  createRoom: ['/rooms'],
  availability: ['/availability', '/rooms/availability'],
  book: ['/book', '/reservations'],
  checkOut: ['/reservations/:id/check-out']
};

router.post(paths.createRoom, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const room = await createRoom(tenantId, req.body);
    res.status(201).json(room);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get(paths.availability, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const checkIn = req.query.checkIn as string;
    const checkOut = req.query.checkOut as string;
    const guests = parseInt(req.query.guests as string) || 1;
    const rooms = await getAvailableRooms(tenantId, checkIn, checkOut, guests);
    res.status(200).json(rooms);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.book, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const reservation = await createReservation(tenantId, req.body);
    res.status(201).json(reservation);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.checkOut, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await checkOut(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

export { router as hospitalityRouter };
