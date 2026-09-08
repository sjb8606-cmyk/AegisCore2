CREATE TABLE hvac_equipment_registry (
  equipment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  property_id UUID NOT NULL,
  system_type TEXT NOT NULL CHECK (
    system_type IN (
      'furnace',
      'ac',
      'heat_pump',
      'ductless_mini_split'
    )
  ),
  manufacturer TEXT NOT NULL,
  model_number TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  install_date TIMESTAMPTZ NOT NULL,
  refrigerant_type TEXT NOT NULL,
  warranty_expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, serial_number)
);

CREATE INDEX idx_hvac_equipment_tenant_client
  ON hvac_equipment_registry (
    tenant_id,
    client_id
  );

CREATE INDEX idx_hvac_equipment_tenant_property
  ON hvac_equipment_registry (
    tenant_id,
    property_id
  );

CREATE INDEX idx_hvac_equipment_tenant_warranty
  ON hvac_equipment_registry (
    tenant_id,
    warranty_expiry_date
  );

ALTER TABLE hvac_equipment_registry
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE hvac_equipment_registry
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_hvac_equipment_registry
  ON hvac_equipment_registry
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
