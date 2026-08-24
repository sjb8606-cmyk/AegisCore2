CREATE TABLE IF NOT EXISTS aq_transfer (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id TEXT NOT NULL,
  from_site_id TEXT NOT NULL,
  to_site_id TEXT NOT NULL,
  health_certificate_id TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aq_harvest (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  weight_kg NUMERIC NOT NULL,
  grade TEXT,
  lot_code TEXT NOT NULL UNIQUE,
  harvested_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aq_sale (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  harvest_id UUID NOT NULL,
  lot_code TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  quantity_sold NUMERIC NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aq_harvest_lot ON aq_harvest(tenant_id, lot_code);
CREATE INDEX IF NOT EXISTS idx_aq_sale_lot ON aq_sale(tenant_id, lot_code);
