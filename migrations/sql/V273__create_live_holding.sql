CREATE TABLE IF NOT EXISTS live_holding_tanks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  tank_code       VARCHAR(50) NOT NULL,
  location        VARCHAR(255),
  capacity_count  INTEGER NOT NULL CHECK (capacity_count > 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_by      UUID NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, tank_code)
);

CREATE TABLE IF NOT EXISTS live_holding_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  lot_id          UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  tank_id         UUID NOT NULL REFERENCES live_holding_tanks(id) ON DELETE RESTRICT,
  species_id      UUID,
  initial_count   INTEGER NOT NULL CHECK (initial_count > 0),
  current_count   INTEGER NOT NULL CHECK (current_count >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_reason   VARCHAR(30) CHECK (closed_reason IN ('shipped_out', 'processed', 'other', 'mortality_total_loss')),
  placed_by       UUID NOT NULL,
  placed_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS live_holding_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  holding_record_id   UUID NOT NULL REFERENCES live_holding_records(id) ON DELETE RESTRICT,
  event_type          VARCHAR(20) NOT NULL CHECK (event_type IN ('placed', 'mortality', 'transfer', 'removed')),
  quantity_delta      INTEGER NOT NULL,
  to_tank_id          UUID REFERENCES live_holding_tanks(id) ON DELETE SET NULL,
  notes               TEXT,
  recorded_by         UUID NOT NULL,
  recorded_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_holding_tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_holding_tanks FORCE ROW LEVEL SECURITY;
ALTER TABLE live_holding_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_holding_records FORCE ROW LEVEL SECURITY;
ALTER TABLE live_holding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_holding_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_live_holding_tanks ON live_holding_tanks
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_live_holding_records ON live_holding_records
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_live_holding_events ON live_holding_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_live_holding_records_lot ON live_holding_records(tenant_id, lot_id);
CREATE INDEX IF NOT EXISTS idx_live_holding_records_tank ON live_holding_records(tenant_id, tank_id);
CREATE INDEX IF NOT EXISTS idx_live_holding_records_status ON live_holding_records(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_live_holding_events_record ON live_holding_events(tenant_id, holding_record_id, recorded_at);
