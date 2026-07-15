import { Router, Request, Response } from 'express';
import { indexDocument, semanticSearch, ErrorCode } from '../../../../platform/ai-search/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId };
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
