import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'webhooks.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { endpointCount: 5, timeoutSeconds: 5, retryAttempts: 5 } };
}

export function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function createEndpoint(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Webhooks vertical is disabled', ErrorCode.FORBIDDEN);

  // Validate only HTTPS or development loopbacks
  const url = data.url || '';
  if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
    throw new AppError('Only secure HTTPS endpoints or local loopbacks allowed', ErrorCode.BAD_REQUEST);
  }

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM webhook_endpoints WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.endpointCount) {
    throw new AppError('Webhook endpoint capacity limits reached', ErrorCode.FORBIDDEN);
  }

  const endpointId = crypto.randomUUID();
  const secret = data.secret || crypto.randomBytes(32).toString('hex');

  const insertQuery = `
    INSERT INTO webhook_endpoints (id, tenant_id, url, description, secret, events, custom_headers)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    endpointId, tenantId, url, data.description || null, secret, data.events || ['*'], JSON.stringify(data.customHeaders || {})
  ], tenantId);

  return result[0];
}

export async function deliverWebhook(tenantId: string, endpointId: string, eventType: string, payload: any) {
  const cfg = loadConfig();

  const endpointRes = await withTenantQuery('SELECT * FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [endpointId, tenantId], tenantId);
  const endpoint = endpointRes[0];
  if (!endpoint) throw new AppError('Webhook endpoint not found', ErrorCode.NOT_FOUND);

  const start = Date.now();
  const bodyString = JSON.stringify({
    event: eventType,
    data: payload,
    timestamp: new Date().toISOString()
  });

  const signature = generateSignature(bodyString, endpoint.secret);
  let statusCode = 500;
  let responseBody = '';
  let errorMessage = null;

  try {
    // Standard Global Node Fetch execution
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ruthless-Signature': `sha256=${signature}`
      },
      body: bodyString,
      signal: AbortSignal.timeout(cfg.limits.timeoutSeconds * 1000)
    });

    statusCode = res.status;
    responseBody = await res.text();
  } catch (err) {
    errorMessage = (err as Error).message;
  }

  const duration = Date.now() - start;
  const logId = crypto.randomUUID();

  // Log Webhook Ingestion metrics
  const logQuery = `
    INSERT INTO webhook_logs (id, tenant_id, endpoint_id, event_type, status_code, duration_ms, response_body, error_message, attempt_number)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) RETURNING *;
  `;
  const logResult = await withTenantQuery(logQuery, [
    logId, tenantId, endpointId, eventType, statusCode, duration, responseBody.substring(0, 500), errorMessage
  ], tenantId);

  return logResult[0];
}

export async function getWebhookLogs(tenantId: string, endpointId: string) {
  const res = await withTenantQuery('SELECT * FROM webhook_logs WHERE endpoint_id = $1 AND tenant_id = $2 ORDER BY created_at DESC', [endpointId, tenantId], tenantId);
  return res;
}
