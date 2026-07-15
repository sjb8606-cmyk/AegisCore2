import { Router, Request, Response } from 'express';
import { publishApiSpec, getPublishedSpec, createChangelogEntry, createSandboxKey, ErrorCode } from '../../../../platform/developer-portal/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  publish: ['/specs', '/api/developer-portal/specs'],
  getLatest: ['/specs/latest', '/api/developer-portal/specs/latest'],
  changelog: ['/changelogs', '/api/developer-portal/changelogs'],
  createKey: ['/sandbox-keys', '/api/developer-portal/sandbox-keys']
};

router.post(paths.publish, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const spec = await publishApiSpec(tenantId, req.body.version, req.body.spec);
    res.status(201).json(spec);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getLatest, async (req: Request, res: Response) => {
  try {
    const tenantId = req.header('x-tenant-id') || req.query.tenantId as string;
    if (!tenantId) throw { message: 'Missing tenantId', code: (ErrorCode as any).BAD_REQUEST };
    const spec = await getPublishedSpec(tenantId);
    res.status(200).json(spec);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.changelog, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const entry = await createChangelogEntry(tenantId, userId, req.body);
    res.status(201).json(entry);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createKey, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await createSandboxKey(tenantId, userId, req.body.name);
    res.status(201).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as developerPortalRouter };
