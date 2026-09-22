-- @platform/plugin-system — plugin registry, config, hooks

CREATE TABLE IF NOT EXISTS plugins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key             VARCHAR(100) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  version         VARCHAR(40) NOT NULL DEFAULT '0.1.0',
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered','enabled','disabled','error')),
  config          JSONB NOT NULL DEFAULT '{}',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_hooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plugin_id       UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  event_name      VARCHAR(120) NOT NULL,
  handler_key     VARCHAR(120) NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plugin_id, event_name, handler_key)
);

CREATE INDEX IF NOT EXISTS idx_plugins_tenant ON plugins (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_plugin_hooks_event ON plugin_hooks (tenant_id, event_name, active);

ALTER TABLE plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_hooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_plugins ON plugins;
CREATE POLICY tenant_isolation_plugins ON plugins
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_plugin_hooks ON plugin_hooks;
CREATE POLICY tenant_isolation_plugin_hooks ON plugin_hooks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
