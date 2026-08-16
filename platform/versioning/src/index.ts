import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const RegisterVersionSchema = z.object({
  version_label: z.string().min(1).regex(/^v\d+/),
  status: z.enum(['active', 'deprecated', 'sunset', 'draft']).default('draft'),
  released_at: z.string().datetime().optional(),
  sunset_at: z.string().datetime().optional(),
  rollout_pct: z.number().int().min(0).max(100).default(100),
});

export const PinVersionSchema = z.object({
  version_id: z.string().uuid(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'versioning.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { sunsetEnforcement: true, perTenantPinning: true }, thresholds: { defaultVersion: "v1" } };
}

export function extractVersionFromPath(urlPath: string): string | null {
  const match = urlPath.match(/^\/(v\d+)/);
  return match ? match[1] : null;
}

export async function registerVersion(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Versioning module is disabled', 'FORBIDDEN');

  const parsed = RegisterVersionSchema.parse(data);
  const versionId = crypto.randomUUID();

  const releasedAt = parsed.released_at || new Date().toISOString();
  const sunsetAt = parsed.sunset_at || null;

  const res = await withTenantQuery(`
    INSERT INTO api_versions (id, tenant_id, version_label, status, released_at, sunset_at, rollout_pct)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [versionId, tenantId, parsed.version_label, parsed.status, releasedAt, sunsetAt, parsed.rollout_pct], tenantId);

  return res[0];
}

export async function pinTenantVersion(tenantId: string, data: any, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.perTenantPinning) {
    throw new AppError('Per-tenant pinning tier is disabled', 'FORBIDDEN');
  }

  const parsed = PinVersionSchema.parse(data);
  const cleanUserId = parseUserId(userId);
  const pinId = crypto.randomUUID();

  // Verify that the version target exists before pinning
  const verRes = await withTenantQuery('SELECT id FROM api_versions WHERE id = $1 AND tenant_id = $2;', [parsed.version_id, tenantId], tenantId);
  if (!verRes || verRes.length === 0) throw new AppError('Target version not found.', 'NOT_FOUND');

  const res = await withTenantQuery(`
    INSERT INTO tenant_version_pins (id, tenant_id, version_id, pinned_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id) 
    DO UPDATE SET version_id = EXCLUDED.version_id, pinned_at = NOW(), pinned_by = EXCLUDED.pinned_by
    RETURNING *;
  `, [pinId, tenantId, parsed.version_id, cleanUserId], tenantId);

  return res[0];
}

// Deterministic API Negotiation Engine
export async function negotiateVersionForRequest(tenantId: string, reqHeader: any, reqQuery: any, reqPath: string): Promise<string> {
  const cfg = loadConfig();
  
  // 1. Negotiation Priority #1: Check Header value
  let negotiated = reqHeader;

  // 2. Negotiation Priority #2: Check Query Param value
  if (!negotiated && reqQuery) {
    negotiated = reqQuery;
  }

  // 3. Negotiation Priority #3: Extract from URI Path parameter
  if (!negotiated && reqPath) {
    negotiated = extractVersionFromPath(reqPath);
  }

  // 4. Negotiation Priority #4: Fallback to Database Pin
  if (!negotiated && cfg.tiers.perTenantPinning) {
    const pinRes = await withTenantQuery(`
      SELECT v.version_label 
      FROM tenant_version_pins p
      JOIN api_versions v ON p.version_id = v.id
      WHERE p.tenant_id = $1;
    `, [tenantId], tenantId);
    
    if (pinRes && pinRes.length > 0) {
      negotiated = pinRes[0].version_label;
    }
  }

  // 5. Fallback to system default configuration threshold
  if (!negotiated) {
    negotiated = cfg.thresholds.defaultVersion;
  }

  // Sunset Enforcement Rule: Block execution if requested version has been sunsetted
  if (cfg.tiers.sunsetEnforcement) {
    const verRes = await withTenantQuery(`
      SELECT status FROM api_versions WHERE version_label = $1 AND tenant_id = $2;
    `, [negotiated, tenantId], tenantId);
    
    if (verRes && verRes.length > 0 && verRes[0].status === 'sunset') {
      throw new AppError(`Deprecation Block: API Version '${negotiated}' has been sunsetted and is no longer accessible.`, 'FORBIDDEN');
    }
  }

  return negotiated;
}

export async function getVersionLedger(tenantId: string, versionId: string) {
  if (!isValidUuid(versionId)) throw new AppError('Invalid Version ID format.', 'BAD_REQUEST');

  const verRes = await withTenantQuery(`
    SELECT * FROM api_versions WHERE id = $1 AND tenant_id = $2;
  `, [versionId, tenantId], tenantId);
  const version = verRes[0];
  if (!version) throw new AppError('Version record not found.', 'NOT_FOUND');

  const pins = await withTenantQuery(`
    SELECT * FROM tenant_version_pins WHERE version_id = $1 AND tenant_id = $2;
  `, [versionId, tenantId], tenantId);

  return {
    ...version,
    active_pins: pins
  };
}
