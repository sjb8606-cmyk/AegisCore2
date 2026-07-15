import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { ContractsService } from '../../../../platform/contracts/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await ContractsService.createContract(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/sign/:token', async (req: any, res: any, next: any) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    const result = await ContractsService.recordSignature(req.params.token, req.body.signature_data, {
      ip,
      userAgent
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await ContractsService.fetchContracts(req.auth.tenantId);
    return ok(res, { contracts: result });
  } catch (err) {
    next(err);
  }
});

export { router as contractsRouter };
