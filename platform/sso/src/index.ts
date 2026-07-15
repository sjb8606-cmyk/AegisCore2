import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

export const IdpConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['saml', 'oidc']),
  config: z.record(z.any()),
});

// Required shape of `config` specifically for type === 'oidc'. Validated
// lazily (at login/callback time) rather than at creation time, so admins
// can still store partial config, but real auth will fail loudly if
// anything required is missing — never silently succeed.
const OidcIdpConfigSchema = z.object({
  issuer: z.string().url(),
  jwksUri: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url().optional(),
  redirectUri: z.string().url(),
  scope: z.string().optional(),
});

export const SsoConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    oidc: z.boolean().default(true),
    saml: z.boolean().default(true),
    idpManagement: z.boolean().default(true),
    jitProvisioning: z.boolean().default(true),
    roleMapping: z.boolean().default(true),
    domainRouting: z.boolean().default(false),
    sessionValidation: z.boolean().default(true),
    certificateRotation: z.boolean().default(false),
    metadataImport: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
    advancedPolicyEngine: z.boolean().default(false),
    riskBasedAuth: z.boolean().default(false),
    multiIdpFailover: z.boolean().default(false),
  }),
  limits: z.object({
    idpsPerTenant: z.number().default(3),
    certRotationDays: z.number().default(365),
    sessionMaxHours: z.number().default(24),
  }),
});

export type SsoConfig = z.infer<typeof SsoConfigSchema>;

let cachedConfig: SsoConfig | null = null;

export function loadConfig(): SsoConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/sso.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = SsoConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = SsoConfigSchema.parse({
    enabled: true,
    tiers: {
      oidc: true,
      saml: true,
      idpManagement: true,
      jitProvisioning: true,
      roleMapping: true,
      domainRouting: false,
      sessionValidation: true,
      certificateRotation: false,
      metadataImport: false,
      auditTrail: true,
      advancedPolicyEngine: false,
      riskBasedAuth: false,
      multiIdpFailover: false,
    },
    limits: {
      idpsPerTenant: 3,
      certRotationDays: 365,
      sessionMaxHours: 24,
    }
  });
  return cachedConfig;
}

export class SsoService {
  static async createIdentityProvider(tenantId: string, data: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SSO security features are globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.idpManagement) {
      throw new AppError('Identity provider management blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const input = IdpConfigSchema.parse(data);

    const sql = `
      INSERT INTO identity_providers (tenant_id, name, type, config)
      VALUES ($1::uuid, $2, $3, $4::jsonb)
      RETURNING *
    `;
    const params = [tenantId, input.name, input.type, JSON.stringify(input.config)];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to register identity provider', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async initiateSsoLogin(tenantId: string, idpId: string, returnUrl: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SSO security features are globally disabled', ErrorCode.FORBIDDEN);
    }

    const idp = await fetchIdp(tenantId, idpId);

    if (idp.type === 'saml') {
      // Real SAML AuthnRequest generation (deflate + base64 + XML-DSig
      // signing against the IdP's expected binding) needs a dedicated SAML
      // library, which isn't installed. Failing loudly rather than
      // returning a fake redirect that goes nowhere real.
      throw new AppError('SAML login initiation is not yet implemented', ErrorCode.NOT_IMPLEMENTED);
    }

    if (!config.tiers.oidc) {
      throw new AppError('OIDC blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const idpConfig = parseOidcConfig(idp);
    const state = Buffer.from(JSON.stringify({ idpId, returnUrl, nonce: cryptoRandom() })).toString('base64url');

    const authUrl = new URL(idpConfig.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', idpConfig.clientId);
    authUrl.searchParams.set('redirect_uri', idpConfig.redirectUri);
    authUrl.searchParams.set('scope', idpConfig.scope || 'openid email profile');
    authUrl.searchParams.set('state', state);

    return { redirectUrl: authUrl.toString() };
  }

  static async handleSsoCallback(tenantId: string, idpId: string, callbackData: any) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('SSO security features are globally disabled', ErrorCode.FORBIDDEN);
    }

    const idp = await fetchIdp(tenantId, idpId);

    if (idp.type === 'saml') {
      // Real SAML assertion verification (XML-DSig signature check against
      // the IdP's X.509 cert, replay/expiry checks on the assertion) needs a
      // dedicated SAML library, which isn't installed yet. Failing loudly
      // here instead of the previous behavior, which accepted ANY callback
      // data as a successful login.
      throw new AppError('SAML callback verification is not yet implemented', ErrorCode.NOT_IMPLEMENTED);
    }

    if (!config.tiers.oidc) {
      throw new AppError('OIDC blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const idpConfig = parseOidcConfig(idp);
    let idToken: string | undefined = callbackData?.id_token;

    // Authorization code flow: exchange the code for tokens at the IdP's
    // real token endpoint. (This step needs a live IdP to actually succeed —
    // the logic itself has no external dependency to write.)
    if (!idToken && callbackData?.code) {
      if (!idpConfig.tokenEndpoint) {
        throw new AppError('Identity provider is missing tokenEndpoint for code exchange', ErrorCode.INTERNAL);
      }
      const resp = await fetch(idpConfig.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackData.code,
          client_id: idpConfig.clientId,
          redirect_uri: idpConfig.redirectUri,
          ...(idpConfig.clientSecret ? { client_secret: idpConfig.clientSecret } : {}),
        }),
      });
      if (!resp.ok) {
        throw new AppError('Failed to exchange authorization code with identity provider', ErrorCode.UNAUTHORIZED);
      }
      const tokenSet: any = await resp.json();
      idToken = tokenSet.id_token;
    }

    if (!idToken) {
      throw new AppError('No id_token present in SSO callback', ErrorCode.UNAUTHORIZED);
    }

    // The actual fix: verify signature, issuer, audience, and expiry
    // against the IdP's real JWKS — instead of unconditionally returning
    // { success: true } for any callback data at all.
    const jwks = getJwksForIssuer(idpConfig.jwksUri);
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: idpConfig.issuer,
      audience: idpConfig.clientId,
    });

    if (config.tiers.jitProvisioning && payload.email) {
      await withTenantQuery(
        `INSERT INTO sso_users (tenant_id, external_id, email, provider_id, role)
         VALUES ($1::uuid, $2, $3, $4::uuid, 'member')
         ON CONFLICT (tenant_id, provider_id, external_id)
         DO UPDATE SET email = $3, last_login_at = NOW()`,
        [tenantId, payload.sub, payload.email, idp.id],
        tenantId,
      );
    }

    return {
      success: true,
      redirectTo: '/dashboard',
      subject: payload.sub,
      email: payload.email,
    };
  }

  static async fetchProviders(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, name, type, is_active, created_at 
      FROM identity_providers 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

async function fetchIdp(tenantId: string, idpId: string): Promise<any> {
  const rows = await withTenantQuery(
    `SELECT id, name, type, config, is_active FROM identity_providers WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [idpId, tenantId],
    tenantId,
  );
  const idp = rows[0];
  if (!idp || !idp.is_active) {
    throw new AppError('Identity provider not found or inactive', ErrorCode.NOT_FOUND);
  }
  return idp;
}

function parseOidcConfig(idp: any): z.infer<typeof OidcIdpConfigSchema> {
  const raw = typeof idp.config === 'string' ? JSON.parse(idp.config) : idp.config;
  const result = OidcIdpConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      `Identity provider "${idp.name}" is missing required OIDC configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`,
      ErrorCode.INTERNAL,
    );
  }
  return result.data;
}

const _jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwksForIssuer(jwksUri: string) {
  let jwks = _jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    _jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

function cryptoRandom(): string {
  return crypto.randomBytes(16).toString('hex');
}
