CREATE TABLE IF NOT EXISTS mkt_dispute (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  amount_cents INT NOT NULL,
  status TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  resolution_note TEXT,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mkt_dispute_status
  ON mkt_dispute(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_dispute_order
  ON mkt_dispute(tenant_id, order_id);
