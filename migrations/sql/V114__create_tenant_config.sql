DROP TABLE IF EXISTS tenant_config_history CASCADE;
DROP TABLE IF EXISTS tenant_configs CASCADE;
DROP TABLE IF EXISTS config_schemas CASCADE;
DROP TABLE IF EXISTS config_namespaces CASCADE;

CREATE TABLE config_namespaces (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  access_role  VARCHAR(50) DEFAULT 'tenant_admin' NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at   TIMESTAMP WITH TIME ZONE
);

CREATE TABLE config_schemas (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  namespace_id   UUID NOT NULL REFERENCES config_namespaces(id) ON DELETE CASCADE,
  config_key     VARCHAR(255) NOT NULL,
  value_type     VARCHAR(30) CHECK (value_type IN ('string','number','boolean','json','secret')) NOT NULL,
  required       BOOLEAN DEFAULT false NOT NULL,
  default_value  TEXT,
  description    TEXT,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE,
  UNIQUE (tenant_id, namespace_id, config_key)
);

CREATE TABLE tenant_configs (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  namespace_id   UUID NOT NULL REFERENCES config_namespaces(id) ON DELETE CASCADE,
  config_key     VARCHAR(255) NOT NULL,
  config_value   TEXT NOT NULL,
  version        INTEGER DEFAULT 1 NOT NULL,
  updated_by     UUID NOT NULL,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE,
  UNIQUE (tenant_id, namespace_id, config_key)
);

CREATE TABLE tenant_config_history (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  config_id      UUID NOT NULL REFERENCES tenant_configs(id) ON DELETE CASCADE,
  config_key     VARCHAR(255) NOT NULL,
  previous_value TEXT,
  new_value      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  changed_by     UUID NOT NULL,
  changed_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE config_namespaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_config_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_namespaces ON config_namespaces USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_schemas ON config_schemas USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_configs ON tenant_configs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_config_history ON tenant_config_history USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE UNIQUE INDEX idx_config_namespaces_lookup ON config_namespaces(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_config_schemas_namespace ON config_schemas(namespace_id);
CREATE INDEX IF NOT EXISTS idx_tenant_configs_lookup ON tenant_configs(tenant_id, namespace_id, config_key);
CREATE INDEX IF NOT EXISTS idx_config_history_config ON tenant_config_history(config_id, changed_at DESC);
