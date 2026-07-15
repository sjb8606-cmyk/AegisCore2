import { Router, Request, Response } from 'express';
import { createEndpoint, deliverWebhook, getWebhookLogs, ErrorCode } from '../../../../platform/webhooks/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  createEndpoint: ['/endpoints', '/api/webhooks/endpoints'],
  deliver: ['/endpoints/:id/deliver', '/api/webhooks/endpoints/:id/deliver'],
  getLogs: ['/endpoints/:id/logs', '/api/webhooks/endpoints/:id/logs']
};

router.post(paths.createEndpoint, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const endpoint = await createEndpoint(tenantId, userId, req.body);
    res.status(201).json(endpoint);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.deliver, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const log = await deliverWebhook(tenantId, req.params.id, req.body.eventType, req.body.payload);
    res.status(201).json(log);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getLogs, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const logs = await getWebhookLogs(tenantId, req.params.id);
    res.status(200).json(logs);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

export { router as webhooksRouter };
