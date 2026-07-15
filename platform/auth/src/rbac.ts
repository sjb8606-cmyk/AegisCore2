/**
 * platform/auth/src/rbac.ts
 *
 * Role-Based Access Control helpers.
 * Roles are injected via OIDC token claims.
 * Default-deny: if a role or permission is not explicitly granted → rejected.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './oidc';
import { AppError, ErrorCode } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('auth:rbac');

// ── Role Definitions ──────────────────────────────────────────

export const ROLES = {
  SUPER_ADMIN:    'super_admin',
  TENANT_ADMIN:   'tenant_admin',
  DEVELOPER:      'developer',
  ANALYST:        'analyst',
  VIEWER:         'viewer',
  SERVICE:        'service',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Role hierarchy: higher index = more permissions
const ROLE_HIERARCHY: Role[] = [
  ROLES.VIEWER,
  ROLES.ANALYST,
  ROLES.DEVELOPER,
  ROLES.TENANT_ADMIN,
  ROLES.SUPER_ADMIN,
];

// ── Permission Map ────────────────────────────────────────────

const PERMISSIONS: Record<string, Role[]> = {
  'tenant:read':          [ROLES.VIEWER, ROLES.ANALYST, ROLES.DEVELOPER, ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'tenant:write':         [ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'tenant:delete':        [ROLES.SUPER_ADMIN],
  'audit:read':           [ROLES.ANALYST, ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'audit:export':         [ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'secrets:read':         [ROLES.DEVELOPER, ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'secrets:rotate':       [ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'metering:read':        [ROLES.ANALYST, ROLES.TENANT_ADMIN, ROLES.SUPER_ADMIN],
  'metering:write':       [ROLES.SERVICE, ROLES.SUPER_ADMIN],
  'admin:impersonate':    [ROLES.SUPER_ADMIN],
};

// ── Helpers ───────────────────────────────────────────────────

/**
 * Returns true if the request's auth context includes at least one of the required roles.
 */
export function hasRole(req: AuthenticatedRequest, ...requiredRoles: Role[]): boolean {
  if (!req.auth?.roles) return false;
  return requiredRoles.some((r) => req.auth!.roles.includes(r));
}

/**
 * Returns true if the user's highest role satisfies the minimum role requirement.
 */
export function meetsMinimumRole(req: AuthenticatedRequest, minimum: Role): boolean {
  if (!req.auth?.roles) return false;
  const minIdx = ROLE_HIERARCHY.indexOf(minimum);
  return req.auth.roles.some((r) => {
    const idx = ROLE_HIERARCHY.indexOf(r as Role);
    return idx >= minIdx;
  });
}

/**
 * Returns true if the user has the specified permission.
 */
export function hasPermission(req: AuthenticatedRequest, permission: string): boolean {
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;
  return hasRole(req, ...allowedRoles);
}

// ── Express Middleware ────────────────────────────────────────

/**
 * requireRole(...roles) — enforces that the authenticated user has at least one listed role.
 */
export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError('Not authenticated', ErrorCode.UNAUTHORIZED));
    }
    if (!hasRole(req, ...roles)) {
      logger.warn({
        sub:       req.auth.sub,
        tenantId:  req.auth.tenantId,
        required:  roles,
        actual:    req.auth.roles,
      }, 'Authorization denied: insufficient role');
      return next(new AppError('Insufficient permissions', ErrorCode.FORBIDDEN));
    }
    next();
  };
}

/**
 * requirePermission(permission) — enforces a specific named permission.
 */
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError('Not authenticated', ErrorCode.UNAUTHORIZED));
    }
    if (!hasPermission(req, permission)) {
      logger.warn({
        sub:        req.auth.sub,
        tenantId:   req.auth.tenantId,
        permission,
        roles:      req.auth.roles,
      }, 'Authorization denied: missing permission');
      return next(new AppError('Insufficient permissions', ErrorCode.FORBIDDEN));
    }
    next();
  };
}

/**
 * requireMinimumRole(minimum) — enforces role hierarchy.
 */
export function requireMinimumRole(minimum: Role) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError('Not authenticated', ErrorCode.UNAUTHORIZED));
    }
    if (!meetsMinimumRole(req, minimum)) {
      return next(new AppError('Insufficient role level', ErrorCode.FORBIDDEN));
    }
    next();
  };
}
