import { Router } from 'express';
import { runSearch, indexDocument } from '../../../../platform/search/src/index';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

// PUBLIC: Perform a search
router.get('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await runSearch(req.auth.tenantId, req.query.q, req.auth.sub);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// INTERNAL: Add data to the index (Must use Founder Key)
router.post('/index', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    await indexDocument(req.auth.tenantId, req.body.type, req.body.id, req.body.title, req.body.body);
    return ok(res, { indexed: true });
  } catch (err) {
    next(err);
  }
});

export { router as searchRouter };
