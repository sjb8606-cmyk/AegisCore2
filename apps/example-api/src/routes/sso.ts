import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { SsoService } from '../../../../platform/sso/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/idp', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SsoService.createIdentityProvider(req.auth.tenantId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/login', async (req: any, res: any, next: any) => {
  try {
    const result = await SsoService.initiateSsoLogin(
      req.query.tenantId as string, 
      req.query.idpId as string, 
      req.query.returnUrl as string
    );
    return res.redirect(result.redirectUrl);
  } catch (err) {
    next(err);
  }
});

router.post('/callback', async (req: any, res: any, next: any) => {
  try {
    const result = await SsoService.handleSsoCallback(req.body.tenantId, req.body.idpId, req.body);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/providers', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await SsoService.fetchProviders(req.auth.tenantId);
    return ok(res, { providers: result });
  } catch (err) {
    next(err);
  }
});

export { router as ssoRouter };
