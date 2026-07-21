import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { startOAuthFlow, handleOAuthCallback, triggerSync, getSyncLogs, ErrorCode } from '../../../../platform/integrations/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  start: ['/oauth/start', '/api/integrations/oauth/start'],
  callback: ['/oauth/callback', '/api/integrations/oauth/callback'],
  sync: ['/connections/:id/sync', '/api/integrations/connections/:id/sync'],
  logs: ['/connections/:id/logs', '/api/integrations/connections/:id/logs']
};

router.post(paths.start, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await startOAuthFlow(tenantId, req.body.provider, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.callback, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const connection = await handleOAuthCallback(tenantId, req.body.provider, req.body.code, req.body.state, userId);
    res.status(201).json(connection);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.sync, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const syncResult = await triggerSync(tenantId, req.params.id);
    res.status(200).json(syncResult);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.logs, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const logs = await getSyncLogs(tenantId, req.params.id);
    res.status(200).json(logs);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as integrationsRouter };
