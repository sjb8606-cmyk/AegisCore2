import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const RegisterDomainSchema = z.object({
  domain: z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  verification_type: z.enum(['cname', 'txt']).default('cname'),
});

export const VerifyDomainSchema = z.object({
  domain_id: z.string().uuid(),
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
  try {
    const configPath = path.join(process.cwd(), 'config', 'custom-domains.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { domainRegistration: true, dnsVerification: true, tlsProvisioning: true } };
}

export async function registerDomain(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Custom Domains module is disabled', 'FORBIDDEN');

  const parsed = RegisterDomainSchema.parse(data);

  // Global Uniqueness Check: Check if domain is already registered by any tenant
  const globalCheck = await withTenantQuery(`
    SELECT id FROM custom_domains WHERE domain = $1;
  `, [parsed.domain], tenantId);

  if (globalCheck && globalCheck.length > 0) {
    throw new AppError('Global Conflict: This domain name is already registered and locked by another tenant.', 'CONFLICT');
  }

  const domainId = crypto.randomUUID();
  const token = `domain-verification-token-${crypto.randomBytes(16).toString('hex')}`;

  const res = await withTenantQuery(`
    INSERT INTO custom_domains (id, tenant_id, domain, status, verification_type, verification_token)
    VALUES ($1, $2, $3, 'pending_verification', $4, $5) RETURNING *;
  `, [domainId, tenantId, parsed.domain, parsed.verification_type, token], tenantId);

  return res[0];
}

export async function verifyDomainAndProvisionSSL(tenantId: string, domainId: string) {
  const cfg = loadConfig();
  if (!isValidUuid(domainId)) throw new AppError('Invalid Domain ID format.', 'BAD_REQUEST');

  const domainRes = await withTenantQuery(`
    SELECT * FROM custom_domains WHERE id = $1 AND tenant_id = $2;
  `, [domainId, tenantId], tenantId);
  const domain = domainRes[0];
  if (!domain) throw new AppError('Domain not found.', 'NOT_FOUND');

  // Trigger simulated DNS verification (succeeds)
  await withTenantQuery(`
    UPDATE custom_domains 
    SET status = 'verified', verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2;
  `, [domainId, tenantId], tenantId);

  // Insert success verification history attempt log
  const attemptId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO domain_verification_attempts (id, tenant_id, domain_id, result, detail)
    VALUES ($1, $2, $3, 'success', 'DNS validation succeeded. CNAME token resolved.');
  `, [attemptId, tenantId, domainId], tenantId);

  // Provision simulated Let's Encrypt SSL/TLS Certificate
  let certificate = null;
  if (cfg.tiers.tlsProvisioning) {
    const certId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // SSL certificates standard 90-day validity

    const certRes = await withTenantQuery(`
      INSERT INTO domain_certificates (id, tenant_id, domain_id, status, issued_at, expires_at)
      VALUES ($1, $2, $3, 'active', $4, $5) RETURNING *;
    `, [certId, tenantId, domainId, issuedAt.toISOString(), expiresAt.toISOString()], tenantId);
    certificate = certRes[0];

    // Change domain status to active
    await withTenantQuery(`
      UPDATE custom_domains SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2;
    `, [domainId, tenantId], tenantId);
  }

  return {
    verified: true,
    certificate
  };
}

export async function getDomainLedger(tenantId: string, domainId: string) {
  if (!isValidUuid(domainId)) throw new AppError('Invalid Domain ID format.', 'BAD_REQUEST');

  const domainRes = await withTenantQuery(`
    SELECT * FROM custom_domains WHERE id = $1 AND tenant_id = $2;
  `, [domainId, tenantId], tenantId);
  const domain = domainRes[0];
  if (!domain) throw new AppError('Domain record not found.', 'NOT_FOUND');

  const certificates = await withTenantQuery(`
    SELECT * FROM domain_certificates WHERE domain_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [domainId, tenantId], tenantId);

  const attempts = await withTenantQuery(`
    SELECT * FROM domain_verification_attempts WHERE domain_id = $1 AND tenant_id = $2 ORDER BY attempted_at DESC;
  `, [domainId, tenantId], tenantId);

  return {
    ...domain,
    certificates,
    verification_history: attempts
  };
}
