import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { registerDomain, verifyDomainAndProvisionSSL, getDomainLedger } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DOMAIN_ID = '33333333-3333-3333-3333-333333333333';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerDomain', () => {
  it('blocks when the module is disabled', async () => {
    mockConfig({ enabled: false, tiers: {} });
    await expect(registerDomain(TENANT_ID, { domain: 'example.com' })).rejects.toThrow(
      'Custom Domains module is disabled'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects a malformed domain via schema validation', async () => {
    await expect(registerDomain(TENANT_ID, { domain: 'not a domain' })).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects a domain already registered by ANY tenant (global uniqueness)', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'existing-domain-row' }]);
    await expect(registerDomain(TENANT_ID, { domain: 'taken.com' })).rejects.toThrow(
      'Global Conflict: This domain name is already registered and locked by another tenant.'
    );
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('registers a domain in pending_verification status with a real random token', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: DOMAIN_ID, status: 'pending_verification' }]);

    await registerDomain(TENANT_ID, { domain: 'mysite.com' });

    const insertParams = (withTenantQuery as any).mock.calls[1][1];
    expect(insertParams[4]).toMatch(/^domain-verification-token-[0-9a-f]{32}$/);
  });
});

describe('verifyDomainAndProvisionSSL', () => {
  it('rejects a malformed domainId', async () => {
    await expect(verifyDomainAndProvisionSSL(TENANT_ID, 'not-a-uuid')).rejects.toThrow('Invalid Domain ID format.');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the domain does not exist for this tenant', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: true } });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID)).rejects.toThrow('Domain not found.');
  });

  // DEFECT — documented, confirmed by the source's own comments
  // ("Trigger simulated DNS verification (succeeds)", "Provision simulated
  // Let's Encrypt SSL/TLS Certificate"). No real DNS lookup is ever
  // performed. ANY domain, whether or not its CNAME/TXT record was actually
  // configured, is unconditionally marked 'verified' and issued a fake
  // certificate — meaning a domain that will never actually resolve in
  // production still shows as fully active and secured.
  it('DEFECT: DNS verification always succeeds unconditionally — no real lookup happens', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: false } });
    const domain = { id: DOMAIN_ID, domain: 'never-configured-this-dns.com', status: 'pending_verification' };
    (withTenantQuery as any)
      .mockResolvedValueOnce([domain])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID);

    expect(result.verified).toBe(true);
    const updateParams = (withTenantQuery as any).mock.calls[1][1];
    expect(updateParams).toEqual([DOMAIN_ID, TENANT_ID]);
    // TODO(custom-domains launch blocker): perform an actual DNS TXT/CNAME
    // lookup against the domain before marking it verified.
  });

  it('DEFECT: SSL certificate is a fake DB row, not an issued certificate, when tlsProvisioning is on', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: true } });
    const domain = { id: DOMAIN_ID, domain: 'example.com', status: 'pending_verification' };
    (withTenantQuery as any)
      .mockResolvedValueOnce([domain])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'cert-1', status: 'active' }])
      .mockResolvedValueOnce([]);

    const result = await verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID);

    expect(result.certificate.status).toBe('active');
    // TODO(custom-domains launch blocker): integrate a real ACME client (e.g. Let's Encrypt) instead of an INSERT.
  });

  it('skips certificate provisioning entirely when tlsProvisioning tier is off', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: false } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: DOMAIN_ID, status: 'pending_verification' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID);

    expect(result.certificate).toBeNull();
  });
});

describe('getDomainLedger', () => {
  it('rejects a malformed domainId', async () => {
    await expect(getDomainLedger(TENANT_ID, 'not-a-uuid')).rejects.toThrow('Invalid Domain ID format.');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the domain record does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(getDomainLedger(TENANT_ID, DOMAIN_ID)).rejects.toThrow('Domain record not found.');
  });

  it('attaches certificates and verification history', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: DOMAIN_ID, domain: 'example.com' }])
      .mockResolvedValueOnce([{ id: 'cert-1' }])
      .mockResolvedValueOnce([{ id: 'attempt-1', result: 'success' }]);

    const result = await getDomainLedger(TENANT_ID, DOMAIN_ID);

    expect(result.certificates).toEqual([{ id: 'cert-1' }]);
    expect(result.verification_history).toEqual([{ id: 'attempt-1', result: 'success' }]);
  });
});
