CREATE TABLE IF NOT EXISTS dynamic_pricing_occupancy (
  pricing_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  facility_id UUID NOT NULL,
  unit_size TEXT NOT NULL,
  base_rate NUMERIC(12,2) NOT NULL,
  current_occupancy_percent NUMERIC(5,2) NOT NULL,
  dynamic_rate NUMERIC(12,2) NOT NULL,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dynamic_pricing_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_occupancy FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dynamic_pricing_occupancy
  ON dynamic_pricing_occupancy
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_dynamic_pricing_facility
  ON dynamic_pricing_occupancy (
    tenant_id,
    facility_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_dynamic_pricing_facility_size
  ON dynamic_pricing_occupancy (
    tenant_id,
    facility_id,
    unit_size
  );
