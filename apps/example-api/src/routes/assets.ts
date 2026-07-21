import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createAsset, assignAsset, returnAsset, disposeAsset, ErrorCode } from '../../../../platform/assets/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  create: ['/', '/assets', '/api/assets'],
  assign: ['/:id/assign', '/assets/:id/assign', '/api/assets/:id/assign'],
  returnAsset: ['/:id/return', '/assets/:id/return', '/api/assets/:id/return'],
  dispose: ['/:id/dispose', '/assets/:id/dispose', '/api/assets/:id/dispose']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const asset = await createAsset(tenantId, req.body);
    res.status(201).json(asset);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.assign, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await assignAsset(tenantId, req.params.id, req.body.assignedTo, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.returnAsset, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await returnAsset(tenantId, req.params.id);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.dispose, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await disposeAsset(tenantId, req.params.id, req.body.reason, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as assetsRouter };
