CREATE TABLE IF NOT EXISTS pos_manager_override (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id TEXT,
  register_id TEXT,
  cashier_id TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  override_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  amount_cents INT,
  original_amount_cents INT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pos_override_mgr
  ON pos_manager_override(tenant_id, manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_override_type
  ON pos_manager_override(tenant_id, override_type, created_at DESC);
