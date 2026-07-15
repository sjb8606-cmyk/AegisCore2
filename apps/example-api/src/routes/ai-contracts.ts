import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { AiContractsService } from '../../../../platform/ai-contracts/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/upload', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiContractsService.ingestContract(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/analyze', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiContractsService.analyzeContract(req.auth.tenantId, req.body.contractId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/contracts', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AiContractsService.fetchContracts(req.auth.tenantId);
    return ok(res, { contracts: result });
  } catch (err) {
    next(err);
  }
});

export { router as aiContractsRouter };
