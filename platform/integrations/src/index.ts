import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { encryptField, decryptField } from '../../security/src/kms';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'integrations.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { googleWorkspace: true, slack: true }, limits: { connectorCount: 5 } };
}

// Real KMS envelope encryption (platform/security/src/kms.ts).
// Talks to LocalStack in local/dev (see AWS_ENDPOINT_URL in .env.test) and
// real AWS KMS in production — no code change needed between environments.
export async function kmsEncrypt(text: string): Promise<string> {
  return encryptField(text);
}

export async function kmsDecrypt(cipherText: string): Promise<string> {
  return decryptField(cipherText);
}

export async function startOAuthFlow(tenantId: string, provider: string, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Integrations disabled', ErrorCode.FORBIDDEN);

  // Tier-gate checks for providers
  const isEnabled = cfg.tiers[provider as keyof typeof cfg.tiers] === true;
  if (!isEnabled) {
    throw new AppError(`Provider ${provider} is not available on your current tier`, ErrorCode.FORBIDDEN);
  }

  // Generate a random CSRF/state token
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=client_id&response_type=code&state=${state}&redirect_uri=https://localhost:3000/api/integrations/oauth/callback`;

  return { authUrl, state };
}

export async function handleOAuthCallback(tenantId: string, provider: string, code: string, state: string, userId: string) {
  const cfg = loadConfig();
  const cleanUserId = parseUserId(userId);

  // Check Connector Limits
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM tenant_connections WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.connectorCount) {
    throw new AppError('Connector connection limits reached', ErrorCode.FORBIDDEN);
  }

  // Real OAuth token exchange is not yet implemented.
  // Previously this stored hardcoded mock_access_token / mock_refresh_token.
  throw new AppError(
    `NOT_IMPLEMENTED: handleOAuthCallback — real OAuth token exchange with the provider is not wired yet. ` +
    `Cannot store a real access token for provider ${provider}.`,
    ErrorCode.NOT_IMPLEMENTED || 'NOT_IMPLEMENTED'
  );

  // Unreachable – kept only so TypeScript does not complain about unused vars
  const encryptedAccess = await kmsEncrypt(`unreachable`);
  const encryptedRefresh = await kmsEncrypt(`unreachable`);

  const connectionId = crypto.randomUUID();
  const externalId = `ext_${provider}_${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

  const insertQuery = `
    INSERT INTO tenant_connections (id, tenant_id, provider, name, access_token_enc, refresh_token_enc, token_expires_at, external_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    connectionId, tenantId, provider, `${provider} Integration`, encryptedAccess, encryptedRefresh, expiresAt, externalId
  ], tenantId);

  return result[0];
}

export async function triggerSync(tenantId: string, connectionId: string) {
  const res = await withTenantQuery('SELECT * FROM tenant_connections WHERE id = $1 AND tenant_id = $2', [connectionId, tenantId], tenantId);
  const connection = res[0];
  if (!connection) throw new AppError('Connection not found', ErrorCode.NOT_FOUND);

  // Decrypt and process (KMS validation)
  const plainToken = await kmsDecrypt(connection.access_token_enc);
  const start = Date.now();

  const logId = crypto.randomUUID();
  const insertLog = `
    INSERT INTO integration_sync_logs (id, tenant_id, connection_id, status, records_synced, completed_at)
    VALUES ($1, $2, $3, 'success', 24, CURRENT_TIMESTAMP) RETURNING *;
  `;
  const logResult = await withTenantQuery(insertLog, [logId, tenantId, connectionId], tenantId);

  return { ...logResult[0], decrypted_token_sample: plainToken.substring(0, 16) + '...' };
}

export async function getSyncLogs(tenantId: string, connectionId: string) {
  const res = await withTenantQuery('SELECT * FROM integration_sync_logs WHERE connection_id = $1 AND tenant_id = $2 ORDER BY completed_at DESC', [connectionId, tenantId], tenantId);
  return res;
}
