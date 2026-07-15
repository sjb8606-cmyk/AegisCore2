import { Router, Request, Response } from 'express';
import { moderateContent, resolveReview, getModerationDetails, ErrorCode } from '../../../../platform/ai-moderation/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  screen: ['/screen', '/api/ai-moderation/screen'],
  getLogs: ['/screen/:id', '/api/ai-moderation/screen/:id'],
  override: ['/screen/:id/override', '/api/ai-moderation/screen/:id/override']
};

router.post(paths.screen, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await moderateContent(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getLogs, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const details = await getModerationDetails(tenantId, req.params.id);
    res.status(200).json(details);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.override, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await resolveReview(tenantId, req.params.id, req.body.action, req.body.reason, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as aiModerationRouter };
