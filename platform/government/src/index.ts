import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { encryptField, decryptField } from '../../security/src/kms';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'government.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { encryptedRecords: true }, limits: { atipResponseDays: 30 } };
}

async function enforceHardenedTier(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.tiers?.encryptedRecords !== true) {
    throw new AppError('Government vertical requires the HARDENED tier enabled', ErrorCode.FORBIDDEN);
  }
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

async function generateServiceRequestNumber(tenantId: string): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery(
    "SELECT COUNT(*) as seq FROM service_requests WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE",
    [tenantId], tenantId
  );
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `SERVICE-${dateStr}-${seq}`;
}

async function generateAtipNumber(tenantId: string): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await withTenantQuery(
    "SELECT COUNT(*) as seq FROM atip_requests WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE",
    [tenantId], tenantId
  );
  const seqVal = parseInt(res[0]?.seq || '0', 10) + 1;
  const seq = seqVal.toString().padStart(4, '0');
  return `ATIP-${dateStr}-${seq}`;
}

export async function submitServiceRequest(tenantId: string, data: any) {
  await enforceHardenedTier(tenantId);

  const requestNumber = await generateServiceRequestNumber(tenantId);
  const requestId = crypto.randomUUID();

  // Encrypt PII fields (name, email, and description) inside the encrypted_data column
  const encrypted = await kmsEncrypt(JSON.stringify({
    citizen_name: data.citizenName,
    citizen_email: data.citizenEmail,
    description: data.description
  }));

  const insertQuery = `
    INSERT INTO service_requests (id, tenant_id, request_number, type, subject, encrypted_data, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'received') RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    requestId, tenantId, requestNumber, data.type, data.subject, encrypted
  ], tenantId);

  return result[0];
}

export async function submitAtipRequest(tenantId: string, data: any) {
  await enforceHardenedTier(tenantId);
  const cfg = loadConfig();

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + cfg.limits.atipResponseDays);

  const requestNumber = await generateAtipNumber(tenantId);
  const requestId = crypto.randomUUID();

  const encrypted = await kmsEncrypt(JSON.stringify({
    requester_name: data.requesterName,
    requester_email: data.requesterEmail,
    description: data.description
  }));

  const insertQuery = `
    INSERT INTO atip_requests (id, tenant_id, request_number, subject, regulation, due_date, encrypted_data, status)
    VALUES ($1, $2, $3, $4, $5, $6::date, $7, 'received') RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    requestId, tenantId, requestNumber, data.subject, data.regulation || 'FOIA', dueDate, encrypted
  ], tenantId);

  return result[0];
}

export async function getAtipRequest(tenantId: string, id: string) {
  await enforceHardenedTier(tenantId);

  const res = await withTenantQuery('SELECT * FROM atip_requests WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  const atip = res[0];
  if (!atip) throw new AppError('ATIP request not found', ErrorCode.NOT_FOUND);

  const decryptedBody = await kmsDecrypt(atip.encrypted_data);
  const decryptedObj = JSON.parse(decryptedBody);

  return { ...atip, ...decryptedObj, encrypted_data: '[SECURED_COMPLIANT_VALUE]' };
}
