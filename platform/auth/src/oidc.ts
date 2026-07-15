import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, ErrorCode } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('auth:oidc');

export interface AuthContext {
  sub: string;
  tenantId: string;
  roles: string[];
  jti?: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

// ── OIDC JWKS Verifier ────────────────────────────────────────
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    const uri = process.env.OIDC_JWKS_URI;
    if (!uri) throw new AppError('OIDC_JWKS_URI not configured', ErrorCode.INTERNAL);
    _jwks = createRemoteJWKSet(new URL(uri));
  }
  return _jwks;
}

// ── requireAuth ───────────────────────────────────────────────
export function verifyRequest() { return requireAuth(); }

export function requireAuth() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Standard OIDC JWT verification. (A "side door" internal
      // service-to-service bypass — a static shared secret plus a
      // caller-specified tenant header, checked before this — has been
      // removed. It let anyone holding that one token string impersonate
      // any tenant with no expiry, scope, or signature, defeating RLS
      // tenant isolation platform-wide. If internal service-to-service
      // auth is genuinely needed, use a scoped, expiring credential
      // instead — e.g. short-lived per-service API keys rotated via
      // Vault, or mTLS — not a shared static secret.)
      const authHeader = req.headers['authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Bearer token required.' });
      }

      const token = authHeader.slice(7);
      const audience = process.env.OIDC_AUDIENCE || 'aegiscore';
      const issuer   = process.env.OIDC_ISSUER;

      const { payload } = await jwtVerify(token, getJwks(), {
        audience,
        ...(issuer ? { issuer } : {}),
      });

      const tenantId = (payload['tenant_id'] as string) || (req.headers['x-tenant-id'] as string);
      if (!tenantId) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'tenant_id claim missing.' });
      }

      req.auth = {
        sub: payload.sub || 'unknown',
        tenantId,
        roles: (payload['roles'] as string[]) || [],
        jti: payload.jti,
      };

      return next();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Auth failed');
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token.' });
    }
  };
}
