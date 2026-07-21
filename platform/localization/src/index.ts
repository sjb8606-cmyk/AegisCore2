import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import { AuthenticatedRequest } from '@platform/auth';

export const SetLocalePreferenceSchema = z.object({ locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/) });
export const UpdateTenantLocaleConfigSchema = z.object({ default_locale: z.string().optional(), enforce_locale: z.boolean().optional() });

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', ErrorCode.UNAUTHORIZED);
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const router = Router();

router.put(['/preference', '/api/localization/preference'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const input = SetLocalePreferenceSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO locale_preferences (tenant_id, user_id, locale, timezone) VALUES ($1, $2, $3, null) ON CONFLICT (tenant_id, user_id) DO UPDATE SET locale = EXCLUDED.locale RETURNING *`,
      [tenantId, userId, input.locale], tenantId
    );
    res.json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.put(['/tenant-config', '/api/localization/tenant-config'], async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const input = UpdateTenantLocaleConfigSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO tenant_locale_config (tenant_id, default_theme, enforce_theme) VALUES ($1, COALESCE($2, 'en'), COALESCE($3, false)) ON CONFLICT (tenant_id) DO UPDATE SET default_theme = COALESCE($2, tenant_locale_config.default_theme), enforce_theme = COALESCE($3, tenant_locale_config.enforce_theme) RETURNING *`,
      [tenantId, input.default_locale, input.enforce_locale], tenantId
    );
    res.json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get(['/resolve', '/api/localization/resolve'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const tenantConf = await withTenantQuery(`SELECT default_theme as default_locale, enforce_theme as enforce_locale FROM tenant_locale_config WHERE tenant_id = $1`, [tenantId], tenantId);
    const tenant = tenantConf[0] || { default_locale: 'en', enforce_locale: false };
    
    if (tenant.enforce_locale) return res.json({ locale: tenant.default_locale, direction: 'ltr' });
    
    const userPref = await withTenantQuery(`SELECT locale FROM locale_preferences WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId], tenantId);
    if (userPref[0]?.locale) return res.json({ locale: userPref[0].locale, direction: userPref[0].locale === 'ar' ? 'rtl' : 'ltr' });
    
    res.json({ locale: tenant.default_locale, direction: 'ltr' });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export { router as localizationRouter };
