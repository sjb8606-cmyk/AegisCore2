DROP TABLE IF EXISTS health_alert_subscriptions CASCADE;
DROP TABLE IF EXISTS health_check_results CASCADE;
DROP TABLE IF EXISTS health_check_definitions CASCADE;

CREATE TABLE health_check_definitions (
  id               UUID PRIMARY KEY,
  tenant_id        UUID, -- Nullable to allow global platform probes
  service_name     VARCHAR(100) NOT NULL,
  check_type       VARCHAR(30) NOT NULL CHECK (check_type IN ('liveness','readiness','dependency','tenant')),
  target           VARCHAR(255),
  poll_interval_ms INTEGER DEFAULT 30000 NOT NULL,
  timeout_ms       INTEGER DEFAULT 5000 NOT NULL,
  enabled          BOOLEAN DEFAULT true NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMP WITH TIME ZONE
);

CREATE TABLE health_check_results (
  id             UUID PRIMARY KEY,
  tenant_id      UUID,
  definition_id  UUID NOT NULL REFERENCES health_check_definitions(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL CHECK (status IN ('healthy','degraded','unhealthy','unknown')),
  response_ms    INTEGER NOT NULL,
  detail         JSONB DEFAULT '{}' NOT NULL,
  checked_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE health_alert_subscriptions (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  definition_id  UUID NOT NULL REFERENCES health_check_definitions(id) ON DELETE CASCADE,
  channel        VARCHAR(20) NOT NULL CHECK (channel IN ('webhook','email','in_app')),
  target         TEXT NOT NULL,
  on_status      VARCHAR(20)[] DEFAULT ARRAY['unhealthy','degraded'] NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE
);

ALTER TABLE health_check_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_alert_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_definitions ON health_check_definitions USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_results ON health_check_results USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_alerts ON health_alert_subscriptions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_health_results_definition ON health_check_results(definition_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_definitions_service ON health_check_definitions(service_name, check_type);
