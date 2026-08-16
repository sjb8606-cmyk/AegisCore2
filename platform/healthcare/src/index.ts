import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { encryptField, decryptField } from '../../security/src/kms';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'healthcare.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { encryptedRecords: true }, limits: { patientCount: 1000 } };
}

async function enforceHardenedTier(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.tiers?.encryptedRecords !== true) {
    throw new AppError('Healthcare feature requires the HARDENED tier enabled', ErrorCode.FORBIDDEN);
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

export async function createPatient(tenantId: string, data: any, providerId: string) {
  await enforceHardenedTier(tenantId);
  const cleanProviderId = parseUserId(providerId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM patients WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  const cfg = loadConfig();
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.patientCount) {
    throw new AppError('Patient clinic limits reached', ErrorCode.FORBIDDEN);
  }

  const patientId = crypto.randomUUID();
  const mrn = `HC-${Date.now().toString().slice(-6)}`;
  const encrypted = await kmsEncrypt(JSON.stringify(data));

  const insertQuery = `
    INSERT INTO patients (id, tenant_id, mrn, first_name, last_name, date_of_birth, gender, email, phone, address, emergency_contact, insurance, encrypted_data, assigned_to)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, mrn;
  `;
  const result = await withTenantQuery(insertQuery, [
    patientId, tenantId, mrn, data.first_name, data.last_name, data.date_of_birth,
    data.gender || null, data.email || null, data.phone || null, 
    JSON.stringify(data.address || {}), JSON.stringify(data.emergency_contact || {}), 
    JSON.stringify(data.insurance || {}), encrypted, cleanProviderId
  ], tenantId);

  return result[0];
}

export async function getPatient(tenantId: string, id: string) {
  await enforceHardenedTier(tenantId);

  const patient = await withTenantQuery('SELECT * FROM patients WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [id, tenantId], tenantId);
  if (!patient[0]) throw new AppError('Patient record not found', ErrorCode.NOT_FOUND);

  const decryptedBody = await kmsDecrypt(patient[0].encrypted_data);
  const decryptedObj = JSON.parse(decryptedBody);

  return { ...patient[0], ...decryptedObj, encrypted_data: '[SECURED_COMPLIANT_VALUE]' };
}

export async function createNote(tenantId: string, patientId: string, data: any, authorId: string) {
  await enforceHardenedTier(tenantId);
  const cleanAuthorId = parseUserId(authorId);

  const noteId = crypto.randomUUID();
  const encryptedBody = await kmsEncrypt(JSON.stringify(data.body));

  const insertQuery = `
    INSERT INTO clinical_notes (id, tenant_id, patient_id, authored_by, note_type, encrypted_body)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    noteId, tenantId, patientId, cleanAuthorId, data.note_type, encryptedBody
  ], tenantId);

  return result[0];
}

export async function signNote(tenantId: string, noteId: string, providerId: string) {
  await enforceHardenedTier(tenantId);
  const cleanProviderId = parseUserId(providerId);

  const res = await withTenantQuery(`
    UPDATE clinical_notes 
    SET is_signed = true, signed_at = CURRENT_TIMESTAMP, signed_by = $1 
    WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [cleanProviderId, noteId, tenantId], tenantId);

  if (!res[0]) throw new AppError('Clinical Note not found', ErrorCode.NOT_FOUND);
  return { success: true, signed_at: res[0].signed_at };
}

export async function recordConsent(tenantId: string, patientId: string, data: any) {
  await enforceHardenedTier(tenantId);

  const consentId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO consent_records (id, tenant_id, patient_id, consent_type, version, granted, signature_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    consentId, tenantId, patientId, data.consent_type, data.version || 'v1', data.granted !== false, data.signature_data || null
  ], tenantId);

  return result[0];
}
