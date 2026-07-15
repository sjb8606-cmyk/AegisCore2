DROP TABLE IF EXISTS tenant_version_pins CASCADE;
DROP TABLE IF EXISTS api_version_changelog CASCADE;
DROP TABLE IF EXISTS api_versions CASCADE;

CREATE TABLE api_versions (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  version_label  VARCHAR(50) NOT NULL,
  status         VARCHAR(30) NOT NULL CHECK (status IN ('active','deprecated','sunset','draft')),
  released_at    TIMESTAMP WITH TIME ZONE,
  sunset_at      TIMESTAMP WITH TIME ZONE,
  rollout_pct    INTEGER DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, version_label)
);

CREATE TABLE api_version_changelog (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  version_id     UUID NOT NULL REFERENCES api_versions(id) ON DELETE CASCADE,
  change_type    VARCHAR(30) CHECK (change_type IN ('added','changed','deprecated','removed','fixed','security')),
  description    TEXT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_version_pins (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  version_id     UUID NOT NULL REFERENCES api_versions(id) ON DELETE CASCADE,
  pinned_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  pinned_by      UUID NOT NULL,
  UNIQUE(tenant_id)
);

ALTER TABLE api_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_version_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_version_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_versions ON api_versions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_changelog ON api_version_changelog USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_pins ON tenant_version_pins USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_api_versions_tenant_status ON api_versions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_changelog_version ON api_version_changelog(version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_pins ON tenant_version_pins(tenant_id);
