CREATE TABLE IF NOT EXISTS pos_cash_drawer (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  register_id TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  closed_by TEXT,
  opening_float_cents INT NOT NULL,
  cash_sales_cents INT NOT NULL DEFAULT 0,
  cash_refunds_cents INT NOT NULL DEFAULT 0,
  paid_ins_cents INT NOT NULL DEFAULT 0,
  paid_outs_cents INT NOT NULL DEFAULT 0,
  expected_cents INT NOT NULL,
  counted_cents INT,
  variance_cents INT,
  variance_reason TEXT,
  status TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_drawer_register
  ON pos_cash_drawer(tenant_id, register_id, status);
