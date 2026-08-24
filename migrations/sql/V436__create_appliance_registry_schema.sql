CREATE TABLE appliance_registry (
  appliance_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  appliance_type TEXT NOT NULL
    CHECK (
      appliance_type IN (
        'refrigerator',
        'washer',
        'dryer',
        'dishwasher',
        'oven',
        'range',
        'other'
      )
    ),
  manufacturer TEXT NOT NULL,
  model_number TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  purchase_date DATE,
  warranty_expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appliance_registry_tenant_client
  ON appliance_registry (tenant_id, client_id);

CREATE INDEX idx_appliance_registry_tenant_serial
  ON appliance_registry (tenant_id, serial_number);

ALTER TABLE appliance_registry
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE appliance_registry
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_appliance_registry
  ON appliance_registry
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
