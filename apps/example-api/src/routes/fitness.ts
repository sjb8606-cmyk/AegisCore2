import { Router, Request, Response } from 'express';
import { createMember, createClass, bookClass, registerCheckIn, getClassLedger, AppError, isValidUuid } from '../../../../platform/fitness/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw new AppError('Missing x-tenant-id', 'BAD_REQUEST');
  return { tenantId, userId };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected fitness booking error occurred.',
    code: code
  });
}

const paths = {
  member: ['/members', '/api/fitness/members'],
  class: ['/classes', '/api/fitness/classes'],
  book: ['/bookings', '/api/fitness/bookings'],
  checkin: ['/checkins', '/api/fitness/checkins'],
  ledger: ['/classes/:id/ledger', '/api/fitness/classes/:id/ledger']
};

router.post(paths.member, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createMember(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.class, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createClass(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.book, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await bookClass(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.checkin, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerCheckIn(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const classId = req.params.id;
    if (!isValidUuid(classId)) {
      throw new AppError(`Invalid Class ID format: '${classId}'`, 'BAD_REQUEST');
    }
    const result = await getClassLedger(tenantId, classId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as fitnessRouter, router as 'fitnessRouter' };
