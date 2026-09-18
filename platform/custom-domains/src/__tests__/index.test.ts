import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockFsExists = vi.fn();
const mockFsRead = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockFsExists(...a),
  readFileSync: (...a: unknown[]) => mockFsRead(...a),
}));

import { registerDomain, verifyDomainAndProvisionSSL, getDomainLedger } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DOMAIN_ID = '33333333-3333-3333-3333-333333333333';

function mockConfig(cfg: any) {
  mockFsExists.mockReturnValue(true);
  mockFsRead.mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerDomain', () => {
  it('rejects when module is disabled', async () => {
    mockConfig({ enabled: false });
    await expect(registerDomain(TENANT_ID, { domain: 'example.com' })).rejects.toThrow(
      'Custom Domains module is disabled'
    );
  });
});

describe('verifyDomainAndProvisionSSL', () => {
  it('rejects a malformed domainId', async () => {
    await expect(verifyDomainAndProvisionSSL(TENANT_ID, 'not-a-uuid')).rejects.toThrow(
      'Invalid Domain ID format.'
    );
    expect(mockWithTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the domain does not exist for this tenant', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: true } });
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID)).rejects.toThrow(
      'Domain not found.'
    );
  });

  it('throws NOT_IMPLEMENTED instead of silently succeeding', async () => {
    mockConfig({ enabled: true, tiers: { tlsProvisioning: true } });
    const domain = {
      id: DOMAIN_ID,
      domain: 'never-configured-this-dns.com',
      status: 'pending_verification',
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([domain])
      .mockResolvedValueOnce([]);

    await expect(verifyDomainAndProvisionSSL(TENANT_ID, DOMAIN_ID)).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });
});

describe('getDomainLedger', () => {
  it('returns domain + certificates + attempts', async () => {
    const domain = { id: DOMAIN_ID, domain: 'example.com', status: 'pending_verification' };
    mockWithTenantQuery
      .mockResolvedValueOnce([domain])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getDomainLedger(TENANT_ID, DOMAIN_ID);
    expect(result.domain).toEqual(domain);
    expect(result.certificates).toEqual([]);
    expect(result.verificationAttempts).toEqual([]);
  });
});
