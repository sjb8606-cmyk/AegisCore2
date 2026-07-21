import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createQuote, requestApproval, approveQuote, getQuoteDetails, ErrorCode } from '../../../../platform/quotes/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

// Added '/' to allow direct base path access (e.g. POST /api/quotes)
const paths = {
  create: ['/', '/quotes', '/api/quotes'],
  request: ['/:id/approval-request', '/quotes/:id/approval-request', '/api/quotes/:id/approval-request'],
  approve: ['/:id/approve', '/quotes/:id/approve', '/api/quotes/:id/approve'],
  get: ['/:id', '/quotes/:id', '/api/quotes/:id']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const quote = await createQuote(tenantId, userId, req.body);
    res.status(201).json(quote);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.request, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await requestApproval(tenantId, req.params.id, req.body.approverId);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.approve, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await approveQuote(tenantId, req.params.id, userId, req.body.reason);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.get, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getQuoteDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as quotesRouter };
