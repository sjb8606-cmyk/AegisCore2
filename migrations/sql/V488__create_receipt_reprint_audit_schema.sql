CREATE TABLE IF NOT EXISTS pos_receipt_reprint (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  transaction_id TEXT NOT NULL,
  session_id TEXT,
  register_id TEXT,
  cashier_id TEXT NOT NULL,
  reprint_number INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pos_reprint_txn
  ON pos_receipt_reprint(tenant_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_pos_reprint_session
  ON pos_receipt_reprint(tenant_id, session_id);
