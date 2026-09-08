CREATE TABLE IF NOT EXISTS salon_sku (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  retail_qty INT NOT NULL DEFAULT 0,
  backbar_qty INT NOT NULL DEFAULT 0,
  unit_cost_cents INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_sku_code
  ON salon_sku(tenant_id, sku_code);
CREATE TABLE IF NOT EXISTS salon_inventory_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sku_id UUID NOT NULL,
  bin TEXT NOT NULL,
  quantity INT NOT NULL,
  visit_id UUID,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_salon_inv_sku
  ON salon_inventory_event(tenant_id, sku_id, created_at);
