CREATE TABLE IF NOT EXISTS hold_investigations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  lot_id           UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  reason_category  VARCHAR(30) NOT NULL
                     CHECK (reason_category IN ('contamination', 'temperature_deviation', 'quality_defect', 'regulatory', 'other')),
  reason_detail    TEXT NOT NULL,
  held_lot_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution       VARCHAR(20) CHECK (resolution IN ('release', 'destroy', 'rework')),
  findings         TEXT,
  opened_by        UUID NOT NULL,
  opened_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ
);

ALTER TABLE hold_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hold_investigations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_hold_investigations ON hold_investigations
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_hold_investigations_lot ON hold_investigations(tenant_id, lot_id);
CREATE INDEX IF NOT EXISTS idx_hold_investigations_status ON hold_investigations(tenant_id, status);
