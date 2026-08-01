CREATE TABLE IF NOT EXISTS fisheries_shift_huddles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  shift_date          TIMESTAMPTZ NOT NULL,
  shift_type          VARCHAR(20) NOT NULL CHECK (shift_type IN ('morning', 'afternoon', 'night')),
  staff_count         INTEGER NOT NULL CHECK (staff_count > 0),
  notes               TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  handoff_notes       TEXT,
  safety_incidents    INTEGER DEFAULT 0,
  production_notes    TEXT,
  started_by          UUID NOT NULL,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  ended_by            UUID,
  ended_at            TIMESTAMPTZ
);

ALTER TABLE fisheries_shift_huddles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_shift_huddles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shift_huddles ON fisheries_shift_huddles
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_shift_huddles_tenant ON fisheries_shift_huddles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fisheries_shift_huddles_active ON fisheries_shift_huddles(tenant_id, shift_type, status) WHERE status = 'open';
