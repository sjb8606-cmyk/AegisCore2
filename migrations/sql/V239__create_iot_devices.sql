CREATE TABLE iot_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  device_type   VARCHAR(100) NOT NULL,
  serial_number VARCHAR(255) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'decommissioned')),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, serial_number)
);

CREATE INDEX idx_iot_devices_tenant_created ON iot_devices(tenant_id, created_at DESC);

ALTER TABLE iot_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE iot_devices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_iot_devices ON iot_devices
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
