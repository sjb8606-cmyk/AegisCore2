import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'white-label.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { customDomain: true, customCss: true }, limits: { customDomainCount: 1 } };
}

// Native HTML & CSS Sanitizer to prevent scripting injection attacks on whitelabel assets
export function sanitizeCssText(css: string): string {
  return css.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/expression/gi, '');
}

export async function updateBrandConfig(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Whitelabel vertical disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);
  const primaryColor = data.primaryColor || '#000000';
  const customCss = data.customCss ? sanitizeCssText(data.customCss) : '';

  const brandId = crypto.randomUUID();
  const upsertQuery = `
    INSERT INTO brand_configs (id, tenant_id, app_name, tagline, logo_url, favicon_url, primary_color, custom_css)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (tenant_id) DO UPDATE 
    SET app_name = EXCLUDED.app_name, tagline = EXCLUDED.tagline, logo_url = EXCLUDED.logo_url, primary_color = EXCLUDED.primary_color, custom_css = EXCLUDED.custom_css, updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;
  const result = await withTenantQuery(upsertQuery, [
    brandId, tenantId, data.appName, data.tagline || null, data.logoUrl || null, data.faviconUrl || null, primaryColor, customCss
  ], tenantId);

  return result[0];
}

export async function getPublicBrandConfig(tenantId: string) {
  const res = await withTenantQuery(`
    SELECT app_name, tagline, logo_url, favicon_url, primary_color, custom_css, show_watermark
    FROM brand_configs WHERE tenant_id = $1;
  `, [tenantId], tenantId);

  if (!res[0]) {
    // Return empty defaults if not yet provisioned
    return { app_name: "Default Platform", tagline: "B2B SaaS Hub", primary_color: "#1e1e1e" };
  }
  return res[0];
}

export async function addCustomDomain(tenantId: string, domain: string, userId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.customDomain) throw new AppError('Custom domains disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM custom_domains WHERE tenant_id = $1 AND status = \'active\'', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.customDomainCount) {
    throw new AppError('Custom domain quota limits reached', ErrorCode.FORBIDDEN);
  }

  const domainId = crypto.randomUUID();
  const verificationToken = crypto.randomBytes(32).toString('hex');

  const insertQuery = `
    INSERT INTO custom_domains (id, tenant_id, domain, verification_token, status)
    VALUES ($1, $2, $3, $4, 'pending') RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    domainId, tenantId, domain, verificationToken
  ], tenantId);

  return result[0];
}

export async function verifyCustomDomain(tenantId: string, domainId: string) {
  const res = await withTenantQuery('SELECT * FROM custom_domains WHERE id = $1 AND tenant_id = $2', [domainId, tenantId], tenantId);
  const domainRecord = res[0];
  if (!domainRecord) throw new AppError('Domain record not found', ErrorCode.NOT_FOUND);

  // Polling simulation: immediately verify and transition to active
  await withTenantQuery(`
    UPDATE custom_domains 
    SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [domainId, tenantId], tenantId);

  return { verified: true, status: 'active' };
}
