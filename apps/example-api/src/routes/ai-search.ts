import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { indexDocument, semanticSearch, ErrorCode } from '../../../../platform/ai-search/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId };
}

const paths = {
  index: ['/index', '/api/ai-search/index'],
  search: ['/search', '/api/ai-search/search']
};

router.post(paths.index, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const doc = await indexDocument(tenantId, req.body);
    res.status(201).json(doc);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.search, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const results = await semanticSearch(tenantId, req.body.query, req.body.limit);
    res.status(200).json(results);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as aiSearchRouter };
