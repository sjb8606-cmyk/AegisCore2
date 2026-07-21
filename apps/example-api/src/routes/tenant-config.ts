import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createNamespace, registerSchemaKey, setConfigValue, getNamespaceLedger, AppError, isValidUuid } from '../../../../platform/tenant-config/src/index';

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
    error: msg || 'An unexpected tenant configuration exception occurred.',
    code: code
  });
}

const paths = {
  namespace: ['/namespaces', '/api/tenant-config/namespaces'],
  schema: ['/schemas', '/api/tenant-config/schemas'],
  config: ['/configs', '/api/tenant-config/configs'],
  ledger: ['/namespaces/:id/ledger', '/api/tenant-config/namespaces/:id/ledger']
};

router.post(paths.namespace, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createNamespace(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.schema, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await registerSchemaKey(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.config, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await setConfigValue(tenantId, req.body, userId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const namespaceId = req.params.id;
    if (!isValidUuid(namespaceId)) {
      throw new AppError(`Invalid Namespace ID format: '${namespaceId}'`, 'BAD_REQUEST');
    }
    const result = await getNamespaceLedger(tenantId, namespaceId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as tenantConfigRouter };
