-- V278__create_tenant_apps.sql
--
-- tenant_apps is the missing piece that makes config/apps/*.json actually
-- load-bearing at runtime: which app config a given tenant's requests
-- should be served by. Design: many tenants -> one app_id is the normal
-- case (many NB fish plants all running plain "tidelock", differentiated
-- by their own data via RLS, not by separate config files). A white-label
-- variant (different cores/branding) is a genuinely different app_id that
-- a distinct set of tenants maps to -- not a copy of an existing config
-- with one field changed. tenant_id is the primary key (each tenant maps
-- to exactly one app at a time); app_id is a plain column, so many rows
-- can legitimately share the same app_id.
--
-- app_id is intentionally NOT a foreign key: app configs live in
-- config/apps/<app_id>.json on the filesystem, not in a DB table, so
-- there is nothing in Postgres to reference. Validity of app_id (does a
-- matching config file actually exist) is checked at read time by
-- @platform/app-loader's loadAppConfig(), not by the database.

CREATE TABLE IF NOT EXISTS tenant_apps (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id),
  app_id      TEXT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_apps_app_id ON tenant_apps (app_id);

ALTER TABLE tenant_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_apps FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_apps' AND policyname = 'tenant_isolation_tenant_apps'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_apps ON tenant_apps
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;

-- updated_at trigger, matching the convention set in V1__init.sql's
-- set_updated_at() function.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_apps_set_updated_at'
  ) THEN
    CREATE TRIGGER tenant_apps_set_updated_at
      BEFORE UPDATE ON tenant_apps
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Backfill: the live TIDELOCK pilot tenant ───────────────────
-- config/apps/tidelock.json currently declares tenant_id
-- 660f9500-f30c-52e5-b827-557766550001. That field stops being used for
-- routing after this change (tenant_apps is now authoritative).
--
-- IMPORTANT — verified against this repo, not assumed: that UUID does not
-- appear anywhere in migrations/seeds/dev-seed.sql or anywhere else as an
-- actual tenants row. Nothing before this change ever read config's
-- tenant_id, so nothing forced it to be backed by a real row. Whether it
-- exists as a real row in the production tenants table is unknown from
-- here (no DB access from this environment) -- so this backfill is
-- written to fail safe: it only inserts if a matching tenants row
-- already exists, and does nothing (no error, no silent wrong row) if it
-- doesn't. Run scripts/verify-tidelock-pilot-tenant.sql (below) FIRST
-- against the real production database to know which case you're in.
INSERT INTO tenant_apps (tenant_id, app_id)
SELECT '660f9500-f30c-52e5-b827-557766550001', 'tidelock'
WHERE EXISTS (
  SELECT 1 FROM tenants WHERE id = '660f9500-f30c-52e5-b827-557766550001'
)
ON CONFLICT (tenant_id) DO NOTHING;
