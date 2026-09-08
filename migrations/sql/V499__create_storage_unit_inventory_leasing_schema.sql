CREATE TABLE IF NOT EXISTS storage_units (
  unit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  facility_id UUID NOT NULL,
  unit_size TEXT NOT NULL CHECK (
    unit_size IN (
      'small',
      'medium',
      'large',
      'climate_controlled',
      'outdoor'
    )
  ),
  monthly_rate NUMERIC(12, 2) NOT NULL CHECK (monthly_rate >= 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'available',
      'occupied',
      'reserved',
      'maintenance'
    )
  ),
  tenant_id_holder UUID,
  lease_start_date DATE,
  lease_end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE storage_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_units FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_storage_units
  ON storage_units
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_storage_units_tenant_facility
  ON storage_units (tenant_id, facility_id);

CREATE INDEX IF NOT EXISTS idx_storage_units_tenant_status
  ON storage_units (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_storage_units_tenant_size
  ON storage_units (tenant_id, unit_size);
