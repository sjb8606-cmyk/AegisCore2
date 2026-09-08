CREATE TABLE pool_equipment_assets (
  equipment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  site_id UUID NOT NULL,
  equipment_type TEXT NOT NULL CHECK (
    equipment_type IN (
      'pump',
      'filter',
      'heater',
      'chlorinator',
      'other'
    )
  ),
  install_date TIMESTAMPTZ NOT NULL,
  last_serviced_date TIMESTAMPTZ,
  next_service_due TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pool_equipment_assets_tenant_client
  ON pool_equipment_assets (tenant_id, client_id);

CREATE INDEX idx_pool_equipment_assets_tenant_site
  ON pool_equipment_assets (tenant_id, site_id);

CREATE INDEX idx_pool_equipment_assets_tenant_service_due
  ON pool_equipment_assets (tenant_id, next_service_due);

ALTER TABLE pool_equipment_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_equipment_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pool_equipment_assets
  ON pool_equipment_assets
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
