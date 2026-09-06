/**
 * @platform/sso
 * LIMITATION: SAML initiate/callback honestly throw NOT_IMPLEMENTED (no SAML lib).
 * OIDC path builds real auth URL; callback uses jose jwtVerify (mocked).
 * cachedConfig → vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockJwtVerify = vi.fn();
const mockCreateRemoteJWKSet = vi.fn(() => ({}));

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND',
    INTERNAL: 'INTERNAL', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED', UNAUTHORIZED: 'UNAUTHORIZED',
  },
}));
vi.mock('jose', () => ({
  createRemoteJWKSet: (...a: unknown[]) => mockCreateRemoteJWKSet(...a),
  jwtVerify: (...a: unknown[]) => mockJwtVerify(...a),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const IDP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('sso', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('createIdentityProvider FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { idpManagement: true },
      limits: { idpsPerTenant: 3, certRotationDays: 365, sessionMaxHours: 24 },
    }));
    const { SsoService, ErrorCode } = await load();
    await expect(SsoService.createIdentityProvider(TENANT, {
      name: 'Okta', type: 'oidc', config: {},
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createIdentityProvider inserts and returns row', async () => {
    const row = { id: IDP, name: 'Okta', type: 'oidc' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { SsoService } = await load();
    const result = await SsoService.createIdentityProvider(TENANT, {
      name: 'Okta', type: 'oidc', config: { issuer: 'https://okta.example' },
    });
    expect(result).toEqual(row);
  });

  it('initiateSsoLogin NOT_IMPLEMENTED for SAML (honest limitation)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      id: IDP, name: 'ADFS', type: 'saml', is_active: true, config: {},
    }]);
    const { SsoService, ErrorCode } = await load();
    await expect(SsoService.initiateSsoLogin(TENANT, IDP, 'https://app/callback'))
      .rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED, message: expect.stringMatching(/SAML/i) });
  });

  it('initiateSsoLogin builds OIDC auth URL with state', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      id: IDP, name: 'Okta', type: 'oidc', is_active: true,
      config: JSON.stringify({
        issuer: 'https://issuer.example',
        jwksUri: 'https://issuer.example/jwks',
        clientId: 'client-1',
        authorizationEndpoint: 'https://issuer.example/authorize',
        redirectUri: 'https://app.example/callback',
        scope: 'openid email',
      }),
    }]);
    const { SsoService } = await load();
    const result = await SsoService.initiateSsoLogin(TENANT, IDP, 'https://app/home');
    expect(result.redirectUrl).toContain('https://issuer.example/authorize');
    expect(result.redirectUrl).toContain('client_id=client-1');
    expect(result.redirectUrl).toContain('response_type=code');
    expect(result.redirectUrl).toContain('state=');
  });

  it('handleSsoCallback SAML → NOT_IMPLEMENTED', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      id: IDP, name: 'ADFS', type: 'saml', is_active: true, config: {},
    }]);
    const { SsoService, ErrorCode } = await load();
    await expect(SsoService.handleSsoCallback(TENANT, IDP, { SAMLResponse: 'x' }))
      .rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
  });

  it('handleSsoCallback OIDC verifies id_token and returns success', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{
      id: IDP, name: 'Okta', type: 'oidc', is_active: true,
      config: {
        issuer: 'https://issuer.example',
        jwksUri: 'https://issuer.example/jwks',
        clientId: 'client-1',
        authorizationEndpoint: 'https://issuer.example/authorize',
        redirectUri: 'https://app.example/callback',
      },
    }]);
    // JIT upsert may fire
    mockWithTenantQuery.mockResolvedValueOnce([]);
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'user-sub-1', email: 'user@example.com' },
    });

    const { SsoService } = await load();
    const result = await SsoService.handleSsoCallback(TENANT, IDP, {
      id_token: 'fake.jwt.token',
    });
    expect(result.success).toBe(true);
    expect(result.subject).toBe('user-sub-1');
    expect(result.email).toBe('user@example.com');
    expect(mockJwtVerify).toHaveBeenCalled();
  });

  it('fetchProviders returns list', async () => {
    const rows = [{ id: IDP, name: 'Okta', type: 'oidc', is_active: true }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { SsoService } = await load();
    expect(await SsoService.fetchProviders(TENANT)).toEqual(rows);
  });

  it('initiateSsoLogin NOT_FOUND for inactive idp', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const { SsoService, ErrorCode } = await load();
    await expect(SsoService.initiateSsoLogin(TENANT, IDP, 'https://app'))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});
