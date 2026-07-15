import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { MfaAdvancedService } from '../../../../platform/mfa-advanced/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/enroll/totp', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await MfaAdvancedService.enrollTotp(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/verify', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await MfaAdvancedService.verifyChallenge(req.auth.tenantId, userId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/recovery', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await MfaAdvancedService.generateRecoveryCodes(req.auth.tenantId, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/methods', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await MfaAdvancedService.fetchMethods(req.auth.tenantId, userId);
    return ok(res, { methods: result });
  } catch (err) {
    next(err);
  }
});

export { router as mfaAdvancedRouter };
