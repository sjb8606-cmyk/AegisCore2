import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { ingestEvent, verifyChainIntegrity, getAuditLedger, AppError } from '../../../../platform/audit-log/src/index';

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
    error: msg || 'An unexpected cryptographic audit exception occurred.',
    code: code
  });
}

const paths = {
  ingest: ['/events', '/api/audit-log/events'],
  verify: ['/verify', '/api/audit-log/verify'],
  ledger: ['/ledger', '/api/audit-log/ledger']
};

router.post(paths.ingest, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await ingestEvent(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.verify, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await verifyChainIntegrity(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await getAuditLedger(tenantId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as auditLogRouter };
