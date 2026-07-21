import { AsyncLocalStorage } from 'async_hooks';
import { Response, NextFunction } from 'express';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { z } from 'zod';

const tenantStorage = new AsyncLocalStorage<{ tenantId: string }>();

const TenancyConfigSchema = z.object({
  requireValidTenant: z.boolean(),
  idPatterns: z.object({ uuid: z.boolean(), slug: z.boolean() })
});

export function getCurrentTenantId(): string {
  const ctx = tenantStorage.getStore();
  if (!ctx?.tenantId) throw new AppError('getCurrentTenantId() called outside of tenant context', ErrorCode.UNAUTHORIZED);
  return ctx.tenantId;
}

/**
 * Run `fn` with `tenantId` bound to the current AsyncLocalStorage context.
 * Nesting is safe: an inner call gets its own isolated context, and the
 * outer context is automatically restored once the inner call completes
 * (this is a property of AsyncLocalStorage itself, not extra bookkeeping).
 */
export async function runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    throw new AppError(`Invalid tenantId passed to runWithTenant: ${JSON.stringify(tenantId)}`, ErrorCode.BAD_REQUEST);
  }
  return tenantStorage.run({ tenantId }, fn);
}

/**
 * Bind a verified tenantId onto a request object for handlers that read
 * req.tenantId directly instead of going through getCurrentTenantId().
 * This does NOT itself verify anything — callers must only pass a tenantId
 * that has already been verified (e.g. from req.auth.tenantId after
 * requireAuth() has run), never a raw header or query value.
 */
export function bindTenantToRequest(req: any, tenantId: string): void {
  if (!tenantId || !isValidTenantId(tenantId)) {
    throw new AppError(`Invalid tenantId passed to bindTenantToRequest: ${JSON.stringify(tenantId)}`, ErrorCode.BAD_REQUEST);
  }
  req.tenantId = tenantId;
}

export function tenantResolver() {
  return async (req: any, res: Response, next: NextFunction) => {
    const config = loadConfig('tenancy', TenancyConfigSchema);

    // No fallback to req.headers['x-tenant-id'] on purpose: that header is
    // caller-supplied and unverified. This must only ever trust the
    // tenantId requireAuth() already verified against the JWT and placed
    // on req.auth — falling back to the header would let any authenticated
    // caller impersonate any other tenant just by setting it.
    const tenantId = req.auth?.tenantId;

    if (!tenantId || !isValidTenantId(tenantId)) {
      return res.status(401).json({ error: 'INVALID_TENANT', message: 'A valid, verified tenant context is required.' });
    }

    // FIX: Use .run() instead of mutating to prevent cross-tenant bleed
    tenantStorage.run({ tenantId: tenantId as string }, () => next());
  };
}

export function isValidTenantId(id: string): boolean {
  if (typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
  return uuidRegex.test(id) || slugRegex.test(id);
}
