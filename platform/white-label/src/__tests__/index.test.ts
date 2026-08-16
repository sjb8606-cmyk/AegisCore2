import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { addCustomDomain } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('white-label.addCustomDomain — real cross-tenant uniqueness, matching custom-domains', () => {
  it('blocks registering a domain another tenant already owns — this was the confirmed gap', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
      if (sql.includes('SELECT id FROM custom_domains')) return Promise.resolve([{ id: 'existing-domain-owned-by-another-tenant' }]);
      return Promise.resolve([{ id: 'should-not-reach-insert' }]);
    });

    await expect(
      addCustomDomain(TENANT_ID, 'taken-domain.com', USER_ID),
    ).rejects.toThrow('already registered by another tenant');
  });

  it('allows registering a genuinely available domain', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
      if (sql.includes('SELECT id FROM custom_domains')) return Promise.resolve([]);
      return Promise.resolve([{ id: 'new-domain-1', domain: 'available-domain.com' }]);
    });

    const result = await addCustomDomain(TENANT_ID, 'available-domain.com', USER_ID);
    expect(result.id).toBe('new-domain-1');
  });

  it('checks uniqueness with the domain itself, not scoped by tenant_id — this is the actual fix', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
      if (sql.includes('SELECT id FROM custom_domains')) return Promise.resolve([]);
      return Promise.resolve([{ id: 'new-domain-1' }]);
    });

    await addCustomDomain(TENANT_ID, 'check-this-domain.com', USER_ID);

    const uniquenessCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('SELECT id FROM custom_domains'),
    );
    expect(uniquenessCall[0]).not.toContain('tenant_id');
    expect(uniquenessCall[1]).toEqual(['check-this-domain.com']);
  });
});
