CREATE TABLE IF NOT EXISTS storage_units (
  unit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  facility_id UUID NOT NULL,
  unit_size TEXT NOT NULL
    CHECK (
      unit_size IN (
        'small',
        'medium',
        'large',
        'climate_controlled',
        'outdoor'
      )
    ),
  monthly_rate NUMERIC(12,2) NOT NULL CHECK (monthly_rate >= 0),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (
      status IN (
        'available',
        'occupied',
        'reserved',
        'maintenance'
      )
    ),
  tenant_id_for_lease UUID,
  lease_start_date TIMESTAMPTZ,
  lease_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE storage_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_units FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_storage_units
  ON storage_units
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE INDEX IF NOT EXISTS idx_storage_units_tenant
  ON storage_units (tenant_id);

CREATE INDEX IF NOT EXISTS idx_storage_units_facility_status
  ON storage_units (tenant_id, facility_id, status);

CREATE INDEX IF NOT EXISTS idx_storage_units_facility_size
  ON storage_units (tenant_id, facility_id, unit_size);
