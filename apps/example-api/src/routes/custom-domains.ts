import { Router, Request, Response } from 'express';
import { registerDomain, verifyDomainAndProvisionSSL, getDomainLedger, AppError, isValidUuid } from '../../../../platform/custom-domains/src/index';

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
  const status = code === 'FORBIDDEN' ? 403 : (code === 'CONFLICT' ? 409 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500)));
  
  res.status(status).json({ 
    error: msg || 'An unexpected custom domains exception occurred.',
    code: code
  });
}

const paths = {
  register: ['/domains', '/api/custom-domains/domains'],
  verify: ['/domains/:id/verify', '/api/custom-domains/domains/:id/verify'],
  ledger: ['/domains/:id/ledger', '/api/custom-domains/domains/:id/ledger']
};

router.post(paths.register, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerDomain(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.verify, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const domainId = req.params.id;
    if (!isValidUuid(domainId)) {
      throw new AppError(`Invalid Domain ID format: '${domainId}'`, 'BAD_REQUEST');
    }
    const result = await verifyDomainAndProvisionSSL(tenantId, domainId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const domainId = req.params.id;
    if (!isValidUuid(domainId)) {
      throw new AppError(`Invalid Domain ID format: '${domainId}'`, 'BAD_REQUEST');
    }
    const result = await getDomainLedger(tenantId, domainId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as customDomainsRouter, router as 'custom-domainsRouter' };
