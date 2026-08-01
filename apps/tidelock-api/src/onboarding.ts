import { Router } from 'express';
import { TenantOnboardingService } from '../../../platform/tenant-onboarding/src/index';

const router = Router();

router.post('/', async (req: any, res, next) => {
  try {
    const tenant = await TenantOnboardingService.createTenant(req.auth.sub, req.body);
    res.status(201).json({
      tenant,
      note: 'Tenant created. Your current session token is NOT yet updated with this tenant — depending on your identity provider, you may need to sign in again before tenant-scoped routes will work.',
    });
  } catch (err) { next(err); }
});

router.get('/me', async (req: any, res, next) => {
  try {
    const tenant = await TenantOnboardingService.getTenantForUser(req.auth.sub);
    res.status(200).json({ tenant });
  } catch (err) { next(err); }
});

export { router as onboardingRouter };
