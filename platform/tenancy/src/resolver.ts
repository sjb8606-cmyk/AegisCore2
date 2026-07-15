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
  if (!ctx?.tenantId) throw new AppError('Tenant context missing', ErrorCode.UNAUTHORIZED);
  return ctx.tenantId;
}

export function tenantResolver() {
  return async (req: any, res: Response, next: NextFunction) => {
    const config = loadConfig('tenancy', TenancyConfigSchema);
    const tenantId = req.auth?.tenantId || req.headers['x-tenant-id'];

    if (!tenantId || !isValidTenantId(tenantId)) {
      return res.status(401).json({ error: 'INVALID_TENANT', message: 'A valid Tenant ID is required.' });
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
