import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createClient, checkConflict, createMatter, createTimeEntry, depositTrust, ErrorCode } from '../../../../platform/legal/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createClient: ['/clients', '/api/legal/clients'],
  conflictCheck: ['/clients/conflict-check', '/api/legal/clients/conflict-check'],
  createMatter: ['/matters', '/api/legal/matters'],
  recordTime: ['/matters/:id/time', '/api/legal/matters/:id/time'],
  deposit: ['/matters/:id/trust/deposit', '/api/legal/matters/:id/trust/deposit']
};

router.post(paths.createClient, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const client = await createClient(tenantId, req.body);
    res.status(201).json(client);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.conflictCheck, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await checkConflict(tenantId, req.body.names);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createMatter, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const matter = await createMatter(tenantId, req.body, userId);
    res.status(201).json(matter);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.recordTime, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const entry = await createTimeEntry(tenantId, req.params.id, req.body, userId);
    res.status(201).json(entry);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.deposit, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await depositTrust(tenantId, req.params.id, req.body.client_id, req.body.amount_cents, req.body.description, userId);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as legalRouter };
