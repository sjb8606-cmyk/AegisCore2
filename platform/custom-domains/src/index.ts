import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const RegisterDomainSchema = z.object({
  domain: z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  verification_type: z.enum(['cname', 'txt']).default('cname'),
});

export const VerifyDomainSchema = z.object({
  domain_id: z.string().uuid(),
});

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'custom-domains.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err);
  }
  return {
    enabled: true,
    tiers: {
      domainRegistration: true,
      dnsVerification: true,
      tlsProvisioning: true,
    },
  };
}

export async function registerDomain(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Custom Domains module is disabled', 'FORBIDDEN');

  const parsed = RegisterDomainSchema.parse(data);

  const globalCheck = await withTenantQuery(
    `SELECT id FROM custom_domains WHERE domain = $1;`,
    [parsed.domain],
    tenantId
  );

  if (globalCheck && globalCheck.length > 0) {
    throw new AppError(
      'Global Conflict: This domain name is already registered and locked by another tenant.',
      'CONFLICT'
    );
  }

  const domainId = crypto.randomUUID();
  const token = `domain-verification-token-${crypto.randomBytes(16).toString('hex')}`;

  const res = await withTenantQuery(
    `
    INSERT INTO custom_domains (id, tenant_id, domain, status, verification_type, verification_token)
    VALUES ($1, $2, $3, 'pending_verification', $4, $5) RETURNING *;
  `,
    [domainId, tenantId, parsed.domain, parsed.verification_type, token],
    tenantId
  );

  return res[0];
}

export async function verifyDomainAndProvisionSSL(tenantId: string, domainId: string) {
  if (!isValidUuid(domainId)) {
    throw new AppError('Invalid Domain ID format.', 'BAD_REQUEST');
  }

  const domainRes = await withTenantQuery(
    `SELECT * FROM custom_domains WHERE id = $1 AND tenant_id = $2;`,
    [domainId, tenantId],
    tenantId
  );
  const domain = domainRes[0];
  if (!domain) throw new AppError('Domain not found.', 'NOT_FOUND');

  const attemptId = crypto.randomUUID();
  await withTenantQuery(
    `
    INSERT INTO domain_verification_attempts (id, tenant_id, domain_id, result, detail)
    VALUES ($1, $2, $3, 'failed', 'NOT_IMPLEMENTED: real DNS verification and TLS provisioning are not wired yet');
  `,
    [attemptId, tenantId, domainId],
    tenantId
  );

  throw new AppError(
    `NOT_IMPLEMENTED: verifyDomainAndProvisionSSL — real DNS TXT/CNAME lookup and Let's Encrypt provisioning are not yet implemented. Domain remains in status '${domain.status}'.`,
    'NOT_IMPLEMENTED'
  );
}

export async function getDomainLedger(tenantId: string, domainId: string) {
  if (!isValidUuid(domainId)) throw new AppError('Invalid Domain ID format.', 'BAD_REQUEST');

  const domainRes = await withTenantQuery(
    `SELECT * FROM custom_domains WHERE id = $1 AND tenant_id = $2;`,
    [domainId, tenantId],
    tenantId
  );
  const domain = domainRes[0];
  if (!domain) throw new AppError('Domain record not found.', 'NOT_FOUND');

  const certificates = await withTenantQuery(
    `SELECT * FROM domain_certificates WHERE domain_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;`,
    [domainId, tenantId],
    tenantId
  );

  const attempts = await withTenantQuery(
    `SELECT * FROM domain_verification_attempts WHERE domain_id = $1 AND tenant_id = $2 ORDER BY attempted_at DESC;`,
    [domainId, tenantId],
    tenantId
  );

  return {
    domain,
    certificates,
    verificationAttempts: attempts,
  };
}
