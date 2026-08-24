CREATE TABLE IF NOT EXISTS aq_stock_batch (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id TEXT NOT NULL,
  species TEXT NOT NULL,
  strain TEXT,
  source_hatchery TEXT,
  quantity NUMERIC NOT NULL,
  current_quantity NUMERIC NOT NULL,
  initial_biomass_kg NUMERIC NOT NULL,
  health_certificate_id TEXT,
  holding_unit_id TEXT,
  status TEXT NOT NULL,
  harvest_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS aq_growth_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_aq_batch_site ON aq_stock_batch(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS idx_aq_growth_batch ON aq_growth_event(tenant_id, batch_id, created_at);
