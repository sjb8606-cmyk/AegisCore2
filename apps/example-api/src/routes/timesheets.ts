import { Router, Request, Response } from 'express';
import { clockIn, clockOut, getClockHistory, ErrorCode } from '../../../../platform/timesheets/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

// Fixed relative sub-paths to resolve cleanly inside Express's dynamic mounting rules
const paths = {
  clockIn: ['/clock-in', '/api/timesheets/clock-in'],
  clockOut: ['/clock-out', '/api/timesheets/clock-out'],
  history: ['/history', '/api/timesheets/history']
};

router.post(paths.clockIn, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const event = await clockIn(tenantId, userId, req.body);
    res.status(201).json(event);
  } catch (error: any) { res.status(error.code === (ErrorCode as any).CONFLICT ? 409 : 400).json({ error: error.message }); }
});

router.post(paths.clockOut, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await clockOut(tenantId, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.history, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const history = await getClockHistory(tenantId, userId);
    res.status(200).json(history);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as timesheetsRouter };
