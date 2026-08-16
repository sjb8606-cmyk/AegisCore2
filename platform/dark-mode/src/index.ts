import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { withTenantQuery } from '@platform/tenancy';
import { AuthenticatedRequest } from '@platform/auth';

import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
// Data Validation Schemas
export const SetPreferenceSchema = z.object({
  preference: z.enum(['light', 'dark', 'system']),
});

export const UpdateTenantConfigSchema = z.object({
  default_theme: z.enum(['light', 'dark', 'system']).optional(),
  enforce_theme: z.boolean().optional(),
  token_overrides: z.record(z.string()).optional(),
});

// Resiliency Helpers
export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  }
  const userId = parseUserId(auth.sub);
  return { tenantId: auth.tenantId, userId };
}

// Core Operations Services
export async function resolveEffectiveTheme(tenantId: string, userId: string) {
  const tenantConfigRes = await withTenantQuery(
    `SELECT default_theme, enforce_theme FROM tenant_theme_config WHERE tenant_id = $1`,
    [tenantId], 
    tenantId
  );
  const tenant = tenantConfigRes[0] || { default_theme: 'system', enforce_theme: false };

  // Tenant overrides user preference completely
  if (tenant.enforce_theme) {
    return { theme: tenant.default_theme, reason: 'tenant_enforced' };
  }

  const userPrefRes = await withTenantQuery(
    `SELECT preference FROM theme_preferences WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId], 
    tenantId
  );

  if (userPrefRes[0] && userPrefRes[0].preference) {
    return { theme: userPrefRes[0].preference, reason: 'user_preference' };
  }

  return { theme: tenant.default_theme, reason: 'tenant_default_fallback' };
}

export async function setUserPreference(tenantId: string, userId: string, data: z.infer<typeof SetPreferenceSchema>) {
  const res = await withTenantQuery(
    `INSERT INTO theme_preferences (tenant_id, user_id, preference, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, user_id) 
     DO UPDATE SET preference = EXCLUDED.preference, updated_at = NOW()
     RETURNING *`,
    [tenantId, userId, data.preference], 
    tenantId
  );
  return res[0];
}

export async function updateTenantConfig(tenantId: string, data: z.infer<typeof UpdateTenantConfigSchema>) {
  const pTheme = data.default_theme || null;
  const pEnforce = data.enforce_theme !== undefined ? data.enforce_theme : null;
  const pOverrides = data.token_overrides ? JSON.stringify(data.token_overrides) : null;

  const res = await withTenantQuery(
    `INSERT INTO tenant_theme_config (id, tenant_id, default_theme, enforce_theme, token_overrides, updated_at)
     VALUES (gen_random_uuid(), $1, COALESCE($2, 'system'), COALESCE($3, false), COALESCE($4, '{}'::jsonb), NOW())
     ON CONFLICT (tenant_id) 
     DO UPDATE SET 
       default_theme = COALESCE($2, tenant_theme_config.default_theme),
       enforce_theme = COALESCE($3, tenant_theme_config.enforce_theme),
       token_overrides = COALESCE($4, tenant_theme_config.token_overrides),
       updated_at = NOW()
     RETURNING *`,
    [tenantId, pTheme, pEnforce, pOverrides], 
    tenantId
  );
  return res[0];
}

// Router Declaration
const router = Router();

function handleError(res: Response, error: any) {
  const code = error?.code || 'INTERNAL_ERROR';
  const msg = error?.message || 'Unexpected failure';
  const status = code === 'BAD_REQUEST' ? 400 : 500;
  res.status(status).json({ error: msg, code });
}

router.put('/preference', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const input = SetPreferenceSchema.parse(req.body);
    const result = await setUserPreference(tenantId, userId, input);
    res.json({ preference: result.preference });
  } catch (err: any) { handleError(res, err); }
});

router.put('/tenant-config', async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const input = UpdateTenantConfigSchema.parse(req.body);
    const result = await updateTenantConfig(tenantId, input);
    res.json(result);
  } catch (err: any) { handleError(res, err); }
});

router.get('/resolve', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await resolveEffectiveTheme(tenantId, userId);
    res.json(result);
  } catch (err: any) { handleError(res, err); }
});

export { router as darkModeRouter };
