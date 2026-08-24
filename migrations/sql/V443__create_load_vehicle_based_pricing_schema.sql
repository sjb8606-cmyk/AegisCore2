CREATE TABLE load_vehicle_based_pricing (
  pricing_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  base_rate NUMERIC(12, 2) NOT NULL
    CHECK (base_rate >= 0),
  distance_miles NUMERIC(12, 2) NOT NULL
    CHECK (distance_miles >= 0),
  distance_rate_per_mile NUMERIC(12, 2) NOT NULL
    CHECK (distance_rate_per_mile >= 0),
  volume_or_size_factor NUMERIC(12, 2) NOT NULL
    CHECK (volume_or_size_factor >= 0),
  surcharges JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_price NUMERIC(12, 2) NOT NULL
    CHECK (total_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_load_vehicle_pricing_tenant_job
  ON load_vehicle_based_pricing (
    tenant_id,
    job_id
  );

ALTER TABLE load_vehicle_based_pricing
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE load_vehicle_based_pricing
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_load_vehicle_based_pricing
  ON load_vehicle_based_pricing
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
