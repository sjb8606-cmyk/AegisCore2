CREATE TABLE IF NOT EXISTS fisheries_loss_alerts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  yield_record_id          UUID NOT NULL REFERENCES fisheries_yield_records(id) ON DELETE RESTRICT,
  species_id                UUID NOT NULL REFERENCES fisheries_species(id) ON DELETE RESTRICT,
  notification_success     BOOLEAN NOT NULL,
  notification_log_id      UUID,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, yield_record_id)
);

ALTER TABLE fisheries_loss_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_loss_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_loss_alerts ON fisheries_loss_alerts
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_loss_alerts_tenant ON fisheries_loss_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_loss_alerts_species ON fisheries_loss_alerts(tenant_id, species_id);
