CREATE TABLE iot_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  device_id        UUID NOT NULL,
  alert_type       VARCHAR(100) NOT NULL,
  severity         VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  message          TEXT NOT NULL,
  acknowledged_at  TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_iot_alerts_tenant_created ON iot_alerts(tenant_id, created_at DESC);
CREATE INDEX idx_iot_alerts_tenant_device ON iot_alerts(tenant_id, device_id);

ALTER TABLE iot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE iot_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_iot_alerts ON iot_alerts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
