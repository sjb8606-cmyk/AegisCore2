import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import { AuthenticatedRequest } from '@platform/auth';

export const UpdateUserPreferencesSchema = z.object({
  high_contrast: z.boolean().optional(),
  reduced_motion: z.boolean().optional(),
  font_scale: z.number().min(0.8).max(2.0).optional(),
  screen_reader_hints: z.boolean().optional(),
  keyboard_nav_mode: z.boolean().optional(),
  focus_indicator: z.enum(['default', 'high-visibility', 'none']).optional(),
});

export const UpdateTenantConfigSchema = z.object({
  wcag_level: z.enum(['A', 'AA', 'AAA']).optional(),
  enforce_high_contrast: z.boolean().optional(),
  enforce_reduced_motion: z.boolean().optional(),
  min_font_scale: z.number().min(0.8).max(2.0).optional(),
  max_font_scale: z.number().min(0.8).max(2.0).optional(),
});

export function isValidUuid(id: any): boolean {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', ErrorCode.UNAUTHORIZED);
  return { tenantId: auth.tenantId, userId: parseUserId(auth.sub) };
}

const router = Router();

router.put(['/preferences', '/api/accessibility/preferences'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const input = UpdateUserPreferencesSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO accessibility_preferences (tenant_id, user_id, high_contrast, reduced_motion, font_scale, screen_reader_hints, keyboard_nav_mode, focus_indicator, updated_at)
       VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), COALESCE($5, 1.0), COALESCE($6, false), COALESCE($7, false), COALESCE($8, 'default'), NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         high_contrast = COALESCE($3, accessibility_preferences.high_contrast),
         reduced_motion = COALESCE($4, accessibility_preferences.reduced_motion),
         font_scale = COALESCE($5, accessibility_preferences.font_scale),
         screen_reader_hints = COALESCE($6, accessibility_preferences.screen_reader_hints),
         keyboard_nav_mode = COALESCE($7, accessibility_preferences.keyboard_nav_mode),
         focus_indicator = COALESCE($8, accessibility_preferences.focus_indicator),
         updated_at = NOW()
       RETURNING *`,
      [tenantId, userId, input.high_contrast ?? null, input.reduced_motion ?? null, input.font_scale ?? null, input.screen_reader_hints ?? null, input.keyboard_nav_mode ?? null, input.focus_indicator ?? null], tenantId
    );
    res.json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.put(['/tenant-config', '/api/accessibility/tenant-config'], async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const input = UpdateTenantConfigSchema.parse(req.body);
    const result = await withTenantQuery(
      `INSERT INTO tenant_accessibility_config (id, tenant_id, wcag_level, enforce_high_contrast, enforce_reduced_motion, min_font_scale, max_font_scale, updated_at)
       VALUES (gen_random_uuid(), $1, COALESCE($2, 'AA'), COALESCE($3, false), COALESCE($4, false), COALESCE($5, 0.8), COALESCE($6, 2.0), NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         wcag_level = COALESCE($2, tenant_accessibility_config.wcag_level),
         enforce_high_contrast = COALESCE($3, tenant_accessibility_config.enforce_high_contrast),
         enforce_reduced_motion = COALESCE($4, tenant_accessibility_config.enforce_reduced_motion),
         min_font_scale = COALESCE($5, tenant_accessibility_config.min_font_scale),
         max_font_scale = COALESCE($6, tenant_accessibility_config.max_font_scale),
         updated_at = NOW()
       RETURNING *`,
      [tenantId, input.wcag_level || null, input.enforce_high_contrast ?? null, input.enforce_reduced_motion ?? null, input.min_font_scale ?? null, input.max_font_scale ?? null], tenantId
    );
    res.json(result[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get(['/resolve', '/api/accessibility/resolve'], async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const tenantConfig = await withTenantQuery(`SELECT * FROM tenant_accessibility_config WHERE tenant_id = $1`, [tenantId], tenantId);
    const tenant = tenantConfig[0] || { enforce_high_contrast: false, enforce_reduced_motion: false, min_font_scale: 0.8, max_font_scale: 2.0 };
    
    const userPref = await withTenantQuery(`SELECT * FROM accessibility_preferences WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId], tenantId);
    const user = userPref[0] || { high_contrast: false, reduced_motion: false, font_scale: 1.0 };

    const rawScale = Number(user.font_scale) || 1.0;
    const clampedScale = Math.max(Number(tenant.min_font_scale), Math.min(Number(tenant.max_font_scale), rawScale));

    res.json({
      high_contrast: tenant.enforce_high_contrast || user.high_contrast || false,
      reduced_motion: tenant.enforce_reduced_motion || user.reduced_motion || false,
      font_scale: clampedScale,
      screen_reader_hints: user.screen_reader_hints || false,
      keyboard_nav_mode: user.keyboard_nav_mode || false,
      focus_indicator: user.focus_indicator || 'default'
    });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export { router as accessibilityRouter };
