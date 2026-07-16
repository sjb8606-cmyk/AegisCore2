import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'developer-portal.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { openApiSpec: true, sandboxEnvironment: true }, limits: { sandboxApiKeys: 5 } };
}

export async function publishApiSpec(tenantId: string, version: string, spec: object) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Developer portal vertical is disabled', ErrorCode.FORBIDDEN);
  if (!cfg.tiers.openApiSpec) throw new AppError('OpenAPI Spec publishing is premium-gated', ErrorCode.FORBIDDEN);

  const specId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO api_specs (id, tenant_id, version, spec, is_published)
    VALUES ($1, $2, $3, $4, true) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [specId, tenantId, version, JSON.stringify(spec)], tenantId);
  return res[0];
}

export async function getPublishedSpec(tenantId: string) {
  const res = await withTenantQuery(`
    SELECT * FROM api_specs 
    WHERE tenant_id = $1 AND is_published = true 
    ORDER BY published_at DESC LIMIT 1;
  `, [tenantId], tenantId);
  return res[0];
}

export async function createChangelogEntry(tenantId: string, userId: string, data: any) {
  const cleanUserId = parseUserId(userId);
  const entryId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO changelog_entries (id, tenant_id, version, title, type, description, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    entryId, tenantId, data.version, data.title, data.type || 'feature', data.description, cleanUserId
  ], tenantId);

  return res[0];
}

export async function createSandboxKey(tenantId: string, userId: string, name: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.sandboxEnvironment) throw new AppError('Sandbox environment is premium-gated', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM sandbox_keys WHERE tenant_id = $1 AND is_active = true', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.sandboxApiKeys) {
    throw new AppError('Sandbox Key limits reached for current tier', ErrorCode.FORBIDDEN);
  }

  const rawKey = `rtk_sandbox_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 20);
  const keyId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO sandbox_keys (id, tenant_id, name, key_hash, key_prefix)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    keyId, tenantId, name, keyHash, keyPrefix
  ], tenantId);

  return { key: rawKey, record: result[0] };
}
