/**
 * platform/app-loader/src/tenant-router.ts
 *
 * The missing half of app assembly: given a *verified* tenantId (already
 * extracted from the JWT by @platform/auth's requireAuth(), never a raw
 * header), find which app_id's config that tenant should be served by.
 *
 * Backed by the tenant_apps table (migrations/sql/V278). Many tenants can
 * share one app_id -- that's the normal case (many NB fish plants all on
 * plain "tidelock", differentiated by RLS-scoped data, not by separate
 * configs). A distinct app_id is only for a genuinely different app
 * (different cores/branding), e.g. a future white-label variant.
 */

import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('app-loader:tenant-router');

interface TenantAppRow {
  app_id: string;
}

// Short-TTL cache: avoids a DB round trip on every single request (this
// runs on the hot path of every request once the single-server gateway
// exists) without meaningfully delaying a newly-onboarded tenant --
// worst case they wait out the TTL, not a restart. Intentionally NOT a
// long-lived cache: onboarding a new tenant must never require a deploy.
const APP_ID_CACHE_TTL_MS = 30_000;
const appIdCache = new Map<string, { appId: string; expiresAt: number }>();

export async function resolveAppIdForTenant(tenantId: string): Promise<string> {
  const cached = appIdCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.appId;
  }

  const rows = await withTenantQuery<TenantAppRow>(
    'SELECT app_id FROM tenant_apps WHERE tenant_id = $1',
    [tenantId],
    tenantId,
  );

  // Guard undefined/null as well as empty array — callers/mocks must not
  // crash with TypeError on .length when there is no assignment row.
  if (!Array.isArray(rows) || rows.length === 0) {
    logger.warn(`[tenant-router] no app assignment found for tenant ${tenantId}`);
    throw new AppError(
      `No app assignment found for tenant ${tenantId}`,
      ErrorCode.NOT_FOUND,
    );
  }

  const appId = rows[0].app_id;
  appIdCache.set(tenantId, { appId, expiresAt: Date.now() + APP_ID_CACHE_TTL_MS });
  return appId;
}

/** For tests, and for admin tooling that reassigns a tenant to a different app_id. */
export function clearAppIdCache(tenantId?: string): void {
  if (tenantId) appIdCache.delete(tenantId);
  else appIdCache.clear();
}
