import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { registerVersion, pinTenantVersion, negotiateVersionForRequest, getVersionLedger, AppError, isValidUuid } from '../../../../platform/versioning/src/index';

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
    error: msg || 'An unexpected version negotiation exception occurred.',
    code: code
  });
}

const paths = {
  register: ['/versions', '/api/versioning/versions'],
  pin: ['/tenant/pin', '/api/versioning/tenant/pin'],
  negotiate: ['/negotiate', '/api/versioning/negotiate'],
  ledger: ['/versions/:id/ledger', '/api/versioning/versions/:id/ledger']
};

router.post(paths.register, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerVersion(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.put(paths.pin, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await pinTenantVersion(tenantId, req.body, userId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.negotiate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const reqHeader = req.header('x-api-version');
    const reqQuery = req.query.version;
    const reqPath = req.query.path || req.path;

    const result = await negotiateVersionForRequest(tenantId, reqHeader, reqQuery, String(reqPath));
    res.status(200).json({ effectiveVersion: result });
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const versionId = req.params.id;
    if (!isValidUuid(versionId)) {
      throw new AppError(`Invalid Version ID format: '${versionId}'`, 'BAD_REQUEST');
    }
    const result = await getVersionLedger(tenantId, versionId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as versioningRouter };
