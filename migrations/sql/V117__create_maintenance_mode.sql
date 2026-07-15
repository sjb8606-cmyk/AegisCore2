DROP TABLE IF EXISTS maintenance_notifications CASCADE;
DROP TABLE IF EXISTS maintenance_bypass_entries CASCADE;
DROP TABLE IF EXISTS maintenance_windows CASCADE;

CREATE TABLE maintenance_windows (
  id           UUID PRIMARY KEY,
  tenant_id    UUID, -- Nullable to allow global platform maintenance scopes
  scope        VARCHAR(20) NOT NULL CHECK (scope IN ('platform','tenant')),
  title        VARCHAR(255) NOT NULL,
  reason       TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','canceled')),
  starts_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at),
  CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL)
  )
);

CREATE TABLE maintenance_bypass_entries (
  id           UUID PRIMARY KEY,
  window_id    UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  bypass_type  VARCHAR(20) NOT NULL CHECK (bypass_type IN ('ip','user_id','role')),
  bypass_value VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (window_id, bypass_type, bypass_value)
);

CREATE TABLE maintenance_notifications (
  id                UUID PRIMARY KEY,
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
  window_id         UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  channel           VARCHAR(20) NOT NULL CHECK (channel IN ('email','webhook','in_app')),
  notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN ('early_warning','window_start','window_end','canceled')),
  status            VARCHAR(20) NOT NULL CHECK (status IN ('pending','sent','failed')),
  sent_at           TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE maintenance_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_bypass_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_windows ON maintenance_windows USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_bypass ON maintenance_bypass_entries USING (EXISTS (SELECT 1 FROM maintenance_windows mw WHERE mw.id = window_id AND (mw.tenant_id IS NULL OR mw.tenant_id = current_setting('app.current_tenant_id', true)::uuid))) WITH CHECK (EXISTS (SELECT 1 FROM maintenance_windows mw WHERE mw.id = window_id AND (mw.tenant_id IS NULL OR mw.tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY tenant_isolation_notif ON maintenance_notifications USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_maintenance_windows_active ON maintenance_windows(status, starts_at, ends_at);
CREATE INDEX idx_maintenance_bypass_window ON maintenance_bypass_entries(window_id);
