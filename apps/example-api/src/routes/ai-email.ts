import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createEmailMessage, classifyEmail, generateDraft, getEmailLedger, AppError, isValidUuid } from '../../../../platform/ai-email/src/index';

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
    error: msg || 'An unexpected email intelligence exception occurred.',
    code: code
  });
}

const paths = {
  message: ['/messages', '/api/ai-email/messages'],
  classify: ['/classify', '/api/ai-email/classify'],
  draft: ['/draft', '/api/ai-email/draft'],
  ledger: ['/messages/:id/ledger', '/api/ai-email/messages/:id/ledger']
};

router.post(paths.message, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createEmailMessage(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.classify, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await classifyEmail(tenantId, req.body.emailId, req.body.content);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.draft, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await generateDraft(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const emailId = req.params.id;
    if (!isValidUuid(emailId)) {
      throw new AppError(`Invalid Email ID format: '${emailId}'`, 'BAD_REQUEST');
    }
    const result = await getEmailLedger(tenantId, emailId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiEmailRouter };
