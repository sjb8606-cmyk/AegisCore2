CREATE TABLE IF NOT EXISTS ag_sale (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  harvest_lot_id TEXT NOT NULL,
  crop_cycle_id TEXT,
  field_id TEXT,
  buyer_name TEXT NOT NULL,
  quantity_sold NUMERIC NOT NULL,
  price_per_unit NUMERIC NOT NULL,
  total_revenue NUMERIC NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ag_sale_harvest
  ON ag_sale(tenant_id, harvest_lot_id);
CREATE INDEX IF NOT EXISTS idx_ag_sale_cycle
  ON ag_sale(tenant_id, crop_cycle_id);
