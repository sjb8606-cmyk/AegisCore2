-- @platform/env-manager — environments, variables, promotions, activity

CREATE TABLE IF NOT EXISTS environments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('development','staging','production','custom')),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','teardown_pending','torn_down')),
  is_production   BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS environment_variables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id  UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  key             VARCHAR(255) NOT NULL,
  value           TEXT,
  is_secret       BOOLEAN NOT NULL DEFAULT false,
  updated_by      UUID,
  updated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment_id, key)
);

CREATE TABLE IF NOT EXISTS environment_promotions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_env_id       UUID NOT NULL REFERENCES environments(id),
  target_env_id       UUID NOT NULL REFERENCES environments(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','approved','rejected','completed','failed')),
  requested_by        UUID,
  approved_by         UUID,
  approval_expires_at TIMESTAMPTZ,
  promoted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS environment_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id  UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  action          VARCHAR(100) NOT NULL,
  actor_id        UUID,
  detail          JSONB NOT NULL DEFAULT '{}',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_environments_tenant ON environments (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON environment_variables (environment_id);
CREATE INDEX IF NOT EXISTS idx_env_promotions_tenant ON environment_promotions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_env_activity_env ON environment_activity_log (environment_id, occurred_at DESC);

ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_environments ON environments;
CREATE POLICY tenant_isolation_environments ON environments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_env_vars ON environment_variables;
CREATE POLICY tenant_isolation_env_vars ON environment_variables
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_env_promotions ON environment_promotions;
CREATE POLICY tenant_isolation_env_promotions ON environment_promotions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_env_activity ON environment_activity_log;
CREATE POLICY tenant_isolation_env_activity ON environment_activity_log
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
