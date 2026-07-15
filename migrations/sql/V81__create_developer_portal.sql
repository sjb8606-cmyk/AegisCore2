-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS sandbox_keys CASCADE;
DROP TABLE IF EXISTS changelog_entries CASCADE;
DROP TABLE IF EXISTS api_specs CASCADE;

CREATE TABLE api_specs (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  version       VARCHAR(30) NOT NULL,
  spec          JSONB NOT NULL DEFAULT '{}',
  is_published  BOOLEAN DEFAULT TRUE,
  published_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, version)
);

CREATE TABLE changelog_entries (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  version      VARCHAR(30) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  type         VARCHAR(20) NOT NULL CHECK (type IN ('breaking','feature','improvement','fix','deprecation')),
  description  TEXT NOT NULL,
  created_by   UUID NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sandbox_keys (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  key_hash      VARCHAR(64) NOT NULL,
  key_prefix    VARCHAR(20) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, key_hash)
);

ALTER TABLE api_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_specs ON api_specs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_changelogs ON changelog_entries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_sandbox_keys ON sandbox_keys USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_specs_tenant ON api_specs(tenant_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelogs_tenant ON changelog_entries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_keys_tenant ON sandbox_keys(tenant_id, key_hash) WHERE is_active = true;
