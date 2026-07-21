import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createApiKey, validateApiKey, logRequest, ErrorCode } from '../../../../platform/api-gateway/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createKey: ['/keys', '/api/api-gateway/keys'],
  validateKey: ['/keys/validate', '/api/api-gateway/keys/validate'],
  log: ['/requests/log', '/api/api-gateway/requests/log']
};

router.post(paths.createKey, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await createApiKey(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.validateKey, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await validateApiKey(tenantId, req.body.key);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.log, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const log = await logRequest(tenantId, req.body.keyId, req.body);
    res.status(201).json(log);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as apiGatewayRouter };
