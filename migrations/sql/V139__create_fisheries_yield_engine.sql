CREATE TABLE IF NOT EXISTS fisheries_yield_records (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  batch_id                  UUID NOT NULL REFERENCES fisheries_processing_batches(id) ON DELETE RESTRICT,
  species_id                UUID NOT NULL REFERENCES fisheries_species(id) ON DELETE RESTRICT,
  actual_yield_percent      NUMERIC(5,2) NOT NULL,
  baseline_yield_percent    NUMERIC(5,2),
  deviation_points          NUMERIC(6,2),
  is_underperforming        BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, batch_id)
);

ALTER TABLE fisheries_yield_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_yield_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_yield_records ON fisheries_yield_records
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_yield_tenant ON fisheries_yield_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_yield_species ON fisheries_yield_records(tenant_id, species_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_yield_underperforming ON fisheries_yield_records(tenant_id, is_underperforming) WHERE is_underperforming = true;
