DROP TABLE IF EXISTS mobile_analytics_events CASCADE;
DROP TABLE IF EXISTS mobile_sync_queue CASCADE;
DROP TABLE IF EXISTS mobile_devices CASCADE;

CREATE TABLE mobile_devices (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  user_id             UUID NOT NULL,
  device_fingerprint  TEXT NOT NULL,
  platform            VARCHAR(20) CHECK (platform IN ('ios','android','pwa')),
  app_version         VARCHAR(50) NOT NULL,
  push_token          TEXT,
  status              VARCHAR(20) CHECK (status IN ('active','revoked','suspended')),
  last_seen_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, device_fingerprint)
);

CREATE TABLE mobile_sync_queue (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  device_id      UUID NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  payload        JSONB NOT NULL,
  status         VARCHAR(20) CHECK (status IN ('pending','delivered','failed','expired')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  delivered_at   TIMESTAMP WITH TIME ZONE,
  deleted_at     TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mobile_analytics_events (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  device_id      UUID NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  event_name     VARCHAR(255) NOT NULL,
  properties     JSONB DEFAULT '{}',
  occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE mobile_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_devices ON mobile_devices USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_sync ON mobile_sync_queue USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_analytics_events ON mobile_analytics_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_mobile_devices_tenant_user ON mobile_devices(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_queue_device ON mobile_sync_queue(device_id, status);
CREATE INDEX IF NOT EXISTS idx_mobile_analytics_device ON mobile_analytics_events(device_id, occurred_at DESC);
