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
  try {
    const configPath = path.join(process.cwd(), 'config', 'api-gateway.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { apiKeys: true, ipWhitelisting: true }, limits: { apiKeyCount: 5, requestsPerMinute: 60 } };
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const random = crypto.randomBytes(24).toString('hex');
  return `rtk_${env}_${random}`;
}

export async function createApiKey(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('API Gateway vertical is disabled', ErrorCode.FORBIDDEN);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM api_keys WHERE tenant_id = $1 AND is_active = true', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.apiKeyCount) {
    throw new AppError('API Key capacity limits reached', ErrorCode.FORBIDDEN);
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  const keyId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, ip_whitelist, rate_limit, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::inet[], $8, $9) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    keyId, tenantId, data.name, keyHash, keyPrefix, data.scopes || ['read'], data.ipWhitelist || [], data.rateLimit || cfg.limits.requestsPerMinute, data.expiresAt || null
  ], tenantId);

  return { key: rawKey, record: result[0] };
}

export async function validateApiKey(tenantId: string, rawKey: string) {
  const hash = hashApiKey(rawKey);
  const result = await withTenantQuery(`
    SELECT id, name, scopes, ip_whitelist, rate_limit 
    FROM api_keys 
    WHERE key_hash = $1 AND tenant_id = $2 AND is_active = true AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);
  `, [hash, tenantId], tenantId);

  const keyRecord = result[0];
  if (!keyRecord) return { valid: false };

  return { valid: true, keyId: keyRecord.id, scopes: keyRecord.scopes };
}

export async function logRequest(tenantId: string, keyId: string | null, log: any) {
  const requestId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO api_requests (id, tenant_id, key_id, method, path, status_code, duration_ms, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    requestId, tenantId, keyId, log.method, log.path, log.statusCode, log.durationMs, log.ipAddress || null, log.userAgent || null
  ], tenantId);

  return result[0];
}
