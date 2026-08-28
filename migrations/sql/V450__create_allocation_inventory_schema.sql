CREATE TABLE IF NOT EXISTS ec_stock_level (
  tenant_id UUID NOT NULL,
  sku TEXT NOT NULL,
  on_hand INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, sku)
);
CREATE TABLE IF NOT EXISTS ec_reservation (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  cart_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ec_res_cart
  ON ec_reservation(tenant_id, cart_id, status);
CREATE INDEX IF NOT EXISTS idx_ec_res_sku_active
  ON ec_reservation(tenant_id, sku, status, expires_at);
