CREATE TABLE IF NOT EXISTS fisheries_shipments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  species_id      UUID NOT NULL REFERENCES fisheries_species(id) ON DELETE RESTRICT,
  vessel_name     VARCHAR(255) NOT NULL,
  catch_date      TIMESTAMPTZ NOT NULL,
  weight_kg       NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),
  quality_grade   VARCHAR(20) NOT NULL CHECK (quality_grade IN ('premium', 'standard', 'processing')),
  catch_zone      VARCHAR(100),
  notes           TEXT,
  logged_by       UUID NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE fisheries_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_shipments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shipments ON fisheries_shipments
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_shipments_tenant ON fisheries_shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_shipments_species ON fisheries_shipments(tenant_id, species_id, catch_date);
