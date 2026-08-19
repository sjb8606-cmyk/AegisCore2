-- scripts/verify-tidelock-pilot-tenant.sql
--
-- Read-only. Run this against the REAL production database before relying
-- on V278__create_tenant_apps.sql's backfill for TIDELOCK.
--
-- Usage: psql $DATABASE_URL -f scripts/verify-tidelock-pilot-tenant.sql

\echo 'Checking for the TIDELOCK pilot tenant row (660f9500-f30c-52e5-b827-557766550001)...'

SELECT id, slug, name, plan, status, created_at
FROM tenants
WHERE id = '660f9500-f30c-52e5-b827-557766550001';

-- If the above returns 0 rows: V278's backfill will silently do nothing,
-- and TIDELOCK's real requests will get a NOT_FOUND from
-- resolveAppIdForTenant() until you run something like:
--
--   INSERT INTO tenants (id, slug, name, plan, status)
--   VALUES ('660f9500-f30c-52e5-b827-557766550001', '<real-slug>', '<real-name>', '<real-plan>', 'active');
--
--   INSERT INTO tenant_apps (tenant_id, app_id)
--   VALUES ('660f9500-f30c-52e5-b827-557766550001', 'tidelock');
--
-- filling in the real slug/name/plan for the actual pilot customer --
-- these are not invented here since that's real customer data this
-- environment doesn't have access to.
--
-- If the above returns exactly 1 row: V278's backfill already handles it
-- correctly, nothing further to do.

\echo 'Also confirming no other tenant is already mapped to app_id = tidelock (should be 0 rows before V278 runs):'

SELECT * FROM tenant_apps WHERE app_id = 'tidelock';
