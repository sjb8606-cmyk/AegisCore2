CREATE TABLE IF NOT EXISTS temperature_thresholds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  species_id    UUID,
  stage         VARCHAR(20) NOT NULL CHECK (stage IN ('receiving', 'storage', 'processing', 'shipping')),
  min_celsius   NUMERIC(5,2) NOT NULL,
  max_celsius   NUMERIC(5,2) NOT NULL CHECK (max_celsius >= min_celsius),
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  lot_id            UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  stage             VARCHAR(20) NOT NULL CHECK (stage IN ('receiving', 'storage', 'processing', 'shipping')),
  reading_celsius   NUMERIC(5,2) NOT NULL,
  device_id         VARCHAR(100),
  notes             TEXT,
  threshold_id      UUID REFERENCES temperature_thresholds(id) ON DELETE SET NULL,
  is_deviation      BOOLEAN NOT NULL DEFAULT false,
  recorded_by       UUID NOT NULL,
  recorded_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE temperature_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE temperature_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE temperature_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE temperature_readings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_temperature_thresholds ON temperature_thresholds
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_temperature_readings ON temperature_readings
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_temperature_thresholds_lookup
  ON temperature_thresholds(tenant_id, species_id, stage);

CREATE INDEX IF NOT EXISTS idx_temperature_readings_lot
  ON temperature_readings(tenant_id, lot_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_temperature_readings_deviation
  ON temperature_readings(tenant_id, is_deviation) WHERE is_deviation = true;
