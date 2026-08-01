CREATE TABLE IF NOT EXISTS fisheries_processing_batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  species_id            UUID NOT NULL REFERENCES fisheries_species(id) ON DELETE RESTRICT,
  status                VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  raw_input_weight_kg   NUMERIC(10,2) NOT NULL CHECK (raw_input_weight_kg > 0),
  finished_weight_kg    NUMERIC(10,2) CHECK (finished_weight_kg IS NULL OR finished_weight_kg >= 0),
  started_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  notes                 TEXT,
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fisheries_batch_shipments (
  tenant_id     UUID NOT NULL,
  batch_id      UUID NOT NULL REFERENCES fisheries_processing_batches(id) ON DELETE CASCADE,
  shipment_id   UUID NOT NULL REFERENCES fisheries_shipments(id) ON DELETE RESTRICT,
  PRIMARY KEY (batch_id, shipment_id)
);

ALTER TABLE fisheries_processing_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_processing_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE fisheries_batch_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_batch_shipments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_batches ON fisheries_processing_batches
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_batch_shipments ON fisheries_batch_shipments
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_batches_tenant ON fisheries_processing_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_batches_species_status ON fisheries_processing_batches(tenant_id, species_id, status);
CREATE INDEX IF NOT EXISTS idx_fisheries_batch_shipments_shipment ON fisheries_batch_shipments(tenant_id, shipment_id);
