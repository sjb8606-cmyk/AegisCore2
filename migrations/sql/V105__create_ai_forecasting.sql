DROP TABLE IF EXISTS forecast_scenarios CASCADE;
DROP TABLE IF EXISTS forecast_anomalies CASCADE;
DROP TABLE IF EXISTS forecast_values CASCADE;
DROP TABLE IF EXISTS forecast_series CASCADE;

CREATE TABLE forecast_series (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       UUID,
  metric_name     VARCHAR(100) NOT NULL,
  granularity     VARCHAR(20) CHECK (granularity IN ('hour','day','week','month')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forecast_values (
  id                UUID PRIMARY KEY,
  series_id         UUID NOT NULL REFERENCES forecast_series(id) ON DELETE CASCADE,
  timestamp         TIMESTAMP WITH TIME ZONE NOT NULL,
  actual_value      NUMERIC,
  predicted_value   NUMERIC,
  confidence        NUMERIC(5,2),
  model_version     VARCHAR(50),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forecast_anomalies (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  series_id         UUID NOT NULL REFERENCES forecast_series(id) ON DELETE CASCADE,
  anomaly_type      VARCHAR(50),
  severity          NUMERIC(5,2),
  detected_value    NUMERIC,
  expected_value    NUMERIC,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forecast_scenarios (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  assumptions       JSONB NOT NULL,
  results           JSONB NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE forecast_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_series ON forecast_series USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_values ON forecast_values USING (series_id IN (SELECT id FROM forecast_series WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)) WITH CHECK (series_id IN (SELECT id FROM forecast_series WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY tenant_isolation_anomalies ON forecast_anomalies USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_scenarios ON forecast_scenarios USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_series_tenant ON forecast_series(tenant_id, entity_type, metric_name);
CREATE INDEX IF NOT EXISTS idx_forecast_values_series ON forecast_values(series_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_anomalies_tenant ON forecast_anomalies(tenant_id, created_at DESC);
