CREATE TABLE IF NOT EXISTS aq_mortality_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id TEXT NOT NULL,
  holding_unit_id TEXT,
  quantity NUMERIC NOT NULL,
  cause TEXT NOT NULL,
  stock_class TEXT NOT NULL,
  pct_of_stock NUMERIC NOT NULL,
  reportable BOOLEAN NOT NULL,
  reportable_reason TEXT,
  review_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aq_health_observation (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  diagnostic_result TEXT,
  reportable BOOLEAN NOT NULL,
  review_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aq_mort_batch
  ON aq_mortality_event(tenant_id, batch_id, created_at);
-- NOTE: seed reportable disease list from current CFIA/DAAF authoritative source.
