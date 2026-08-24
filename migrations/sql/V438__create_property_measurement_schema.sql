CREATE TABLE property_measurements (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  client_id UUID NOT NULL,
  measurement_type TEXT NOT NULL CHECK (
    measurement_type IN (
      'lawn',
      'driveway',
      'siding',
      'deck',
      'other'
    )
  ),
  area_sqft NUMERIC NOT NULL CHECK (area_sqft > 0),
  source TEXT NOT NULL CHECK (
    source IN (
      'manual',
      'satellite_estimate',
      'on_site_measured'
    )
  ),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_measurements_tenant_property
  ON property_measurements (tenant_id, property_id);

CREATE INDEX idx_property_measurements_tenant_client
  ON property_measurements (tenant_id, client_id);

ALTER TABLE property_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_measurements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_property_measurements
  ON property_measurements
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
