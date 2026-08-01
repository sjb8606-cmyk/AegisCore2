import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn(() => Promise.resolve(mockClient)),
  query: vi.fn(),
};

vi.mock('../../../tenancy/src/rls', () => ({
  getPool: vi.fn(() => mockPool),
}));

import { TenantOnboardingService, ErrorCode } from '../index';

const OIDC_SUB = 'auth0|abc123';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TenantOnboardingService.createTenant', () => {
  it('creates a real tenant and admin membership within a real transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TENANT_ID, name: 'Cap-Acadie Fish Co', preferred_language: 'fr' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const tenant = await TenantOnboardingService.createTenant(OIDC_SUB, {
      name: 'Cap-Acadie Fish Co',
      preferredLanguage: 'fr',
    });

    expect(tenant.name).toBe('Cap-Acadie Fish Co');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    const membershipInsert = mockClient.query.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO tenant_members')
    );
    expect(membershipInsert[1]).toEqual([TENANT_ID, OIDC_SUB, 'tenant_admin']);
  });

  it('throws CONFLICT and rolls back when the user already belongs to a tenant', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'existing-tenant' }] });

    await expect(
      TenantOnboardingService.createTenant(OIDC_SUB, { name: 'x' })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rolls back and releases the client on any unexpected error', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db exploded'));

    await expect(
      TenantOnboardingService.createTenant(OIDC_SUB, { name: 'x' })
    ).rejects.toThrow('db exploded');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('throws UNAUTHORIZED when no oidcSub is provided', async () => {
    await expect(
      TenantOnboardingService.createTenant('', { name: 'x' })
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });

    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe('TenantOnboardingService.getTenantForUser', () => {
  it('returns null when the user has no tenant yet', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const tenant = await TenantOnboardingService.getTenantForUser(OIDC_SUB);
    expect(tenant).toBeNull();
  });

  it('returns the real tenant when one exists', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: TENANT_ID, name: 'Cap-Acadie Fish Co' }],
    });

    const tenant = await TenantOnboardingService.getTenantForUser(OIDC_SUB);
    expect(tenant?.id).toBe(TENANT_ID);
  });
});
