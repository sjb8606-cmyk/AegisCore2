import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { encryptField } from '../../security/src/kms';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'legal.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { encryptedNotes: true, trustAccounting: true }, limits: { matterCount: 100 }, billingRate: { default: 35000 } };
}

// Real KMS envelope encryption (platform/security/src/kms.ts).
// Talks to LocalStack in local/dev (see AWS_ENDPOINT_URL in .env.test) and
// real AWS KMS in production — no code change needed between environments.
export async function kmsEncrypt(text: string): Promise<string> {
  return encryptField(text);
}

export async function createClient(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Legal Practice vertical is disabled', ErrorCode.FORBIDDEN);

  const encrypted = await kmsEncrypt(JSON.stringify(data.address || {}));
  const clientId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO legal_clients (id, tenant_id, type, name, email, phone, encrypted_data, conflict_names)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    clientId, tenantId, data.type || 'individual', data.name, data.email || null, 
    data.phone || null, encrypted, data.conflict_names || []
  ], tenantId);

  return result[0];
}

export async function checkConflict(tenantId: string, names: string[]) {
  const result = await withTenantQuery(`
    SELECT name, id FROM legal_clients 
    WHERE tenant_id = $1 AND conflict_names && $2::text[]
  `, [tenantId, names], tenantId);

  return { conflicts: result, hasConflict: result.length > 0 };
}

export async function createMatter(tenantId: string, data: any, assignedTo: string) {
  const cfg = loadConfig();
  const cleanAssignedTo = parseUserId(assignedTo);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM matters WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.matterCount) {
    throw new AppError('Matter capacity limits reached', ErrorCode.FORBIDDEN);
  }

  const year = new Date().getFullYear();
  const seqRes = await withTenantQuery(`SELECT COUNT(*) as seq FROM matters WHERE tenant_id = $1 AND EXTRACT(YEAR FROM open_date) = $2`, [tenantId, year], tenantId);
  const seq = (parseInt(seqRes[0]?.seq || '0', 10) + 1).toString().padStart(4, '0');
  const matterNumber = `${year}-${seq}`;

  const matterId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO matters (id, tenant_id, matter_number, client_id, assigned_to, title, practice_area, billing_type, rate_cents)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    matterId, tenantId, matterNumber, data.client_id, cleanAssignedTo, data.title, 
    data.practice_area || null, data.billing_type || 'hourly', data.rate_cents || cfg.billingRate.default
  ], tenantId);

  return result[0];
}

export async function createTimeEntry(tenantId: string, matterId: string, data: any, attorneyId: string) {
  const cleanAttorneyId = parseUserId(attorneyId);
  const amountCents = Math.round((data.minutes * (data.rate_cents || 35000)) / 60);
  const entryId = crypto.randomUUID();

  const insertQuery = `
    INSERT INTO time_entries (id, tenant_id, matter_id, attorney_id, minutes, rate_cents, amount_cents, description, is_billable)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    entryId, tenantId, matterId, cleanAttorneyId, data.minutes, data.rate_cents || 35000, 
    amountCents, data.description, data.is_billable !== false
  ], tenantId);

  return result[0];
}

export async function depositTrust(tenantId: string, matterId: string, clientId: string, amountCents: number, description: string, recordedBy: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.trustAccounting) throw new AppError('Trust accounting disabled', ErrorCode.FORBIDDEN);

  const cleanRecordedBy = parseUserId(recordedBy);

  // Atomic locked SELECT to prevent race-condition balance over-writes
  const accountRes = await withTenantQuery(
    'SELECT id, balance_cents FROM trust_accounts WHERE matter_id = $1 AND tenant_id = $2 FOR UPDATE', 
    [matterId, tenantId], tenantId
  );

  let accountId: string;
  let newBalance = amountCents;

  if (accountRes.length === 0) {
    accountId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO trust_accounts (id, tenant_id, matter_id, client_id, balance_cents)
      VALUES ($1, $2, $3, $4, $5)
    `, [accountId, tenantId, matterId, clientId, amountCents], tenantId);
  } else {
    accountId = accountRes[0].id;
    newBalance = parseInt(accountRes[0].balance_cents, 10) + amountCents;
    await withTenantQuery('UPDATE trust_accounts SET balance_cents = $1 WHERE id = $2 AND tenant_id = $3', [newBalance, accountId, tenantId], tenantId);
  }

  const transactionId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO trust_transactions (id, tenant_id, trust_account_id, type, amount_cents, balance_after, description, recorded_by)
    VALUES ($1, $2, $3, 'deposit', $4, $5, $6, $7)
  `, [transactionId, tenantId, accountId, amountCents, newBalance, description, cleanRecordedBy], tenantId);

  return { success: true, account_id: accountId, balance: newBalance };
}
