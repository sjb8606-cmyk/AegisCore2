-- @platform/rate-limiting — configurable limits, breaches, allow/deny lists

CREATE TABLE IF NOT EXISTS rate_limit_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope           VARCHAR(30) NOT NULL CHECK (scope IN ('tenant', 'user', 'api_key', 'route')),
  scope_key       VARCHAR(255),
  algorithm       VARCHAR(20) NOT NULL CHECK (algorithm IN ('fixed_window', 'sliding_window', 'token_bucket')),
  requests        INTEGER NOT NULL CHECK (requests > 0),
  window_seconds  INTEGER NOT NULL CHECK (window_seconds > 0),
  burst_limit     INTEGER,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope, scope_key)
);

CREATE TABLE IF NOT EXISTS rate_limit_breaches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope           VARCHAR(30) NOT NULL,
  scope_key       VARCHAR(255),
  actor_id        UUID,
  actor_type      VARCHAR(50),
  actor_ip        INET,
  route           VARCHAR(255),
  limit_value     INTEGER NOT NULL,
  request_count   INTEGER NOT NULL,
  window_seconds  INTEGER NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limit_access_list (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_type       VARCHAR(10) NOT NULL CHECK (list_type IN ('allow', 'deny')),
  match_type      VARCHAR(20) NOT NULL CHECK (match_type IN ('ip', 'cidr', 'user_id', 'api_key')),
  match_value     VARCHAR(255) NOT NULL,
  reason          TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, list_type, match_type, match_value)
);

CREATE INDEX IF NOT EXISTS idx_rl_configs_tenant_scope
  ON rate_limit_configs (tenant_id, scope, scope_key);
CREATE INDEX IF NOT EXISTS idx_rl_breaches_tenant
  ON rate_limit_breaches (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_rl_access_tenant
  ON rate_limit_access_list (tenant_id, list_type);

ALTER TABLE rate_limit_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_breaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_access_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_rl_configs ON rate_limit_configs;
CREATE POLICY tenant_isolation_rl_configs ON rate_limit_configs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_rl_breaches ON rate_limit_breaches;
CREATE POLICY tenant_isolation_rl_breaches ON rate_limit_breaches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_rl_access ON rate_limit_access_list;
CREATE POLICY tenant_isolation_rl_access ON rate_limit_access_list
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
