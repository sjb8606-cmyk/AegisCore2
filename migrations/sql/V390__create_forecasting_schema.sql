CREATE TABLE IF NOT EXISTS forecast_series (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value NUMERIC NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forecast_result (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_id TEXT NOT NULL,
  predicted_for TIMESTAMPTZ NOT NULL,
  value NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_forecast_series_entity
  ON forecast_series(tenant_id, entity_id, ts);
