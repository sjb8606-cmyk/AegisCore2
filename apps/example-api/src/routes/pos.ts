import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { openSession, createTransaction, closeSession, ErrorCode } from '../../../../platform/pos/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  open: ['/sessions', '/api/pos/sessions'],
  transact: ['/transactions', '/api/pos/transactions'],
  close: ['/sessions/:id/close', '/api/pos/sessions/:id/close']
};

router.post(paths.open, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const session = await openSession(tenantId, req.body.registerId, req.body.openingCashCents, userId);
    res.status(201).json(session);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.transact, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const tx = await createTransaction(tenantId, userId, req.body);
    res.status(201).json(tx);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.close, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await closeSession(tenantId, req.params.id, req.body.closingCashCents, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as posRouter };
