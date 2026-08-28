CREATE TABLE IF NOT EXISTS rest_void_comp (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount_cents INT NOT NULL,
  reason_code TEXT NOT NULL,
  notes TEXT,
  server_id TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  shift_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_void_comp_shift
  ON rest_void_comp(tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_void_comp_order
  ON rest_void_comp(tenant_id, order_id);
