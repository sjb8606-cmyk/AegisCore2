CREATE TABLE IF NOT EXISTS ec_rma (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  notes TEXT,
  lines JSONB NOT NULL,
  restocking_fee_bps INT NOT NULL DEFAULT 0,
  refund_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ec_rma_order
  ON ec_rma(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_ec_rma_status
  ON ec_rma(tenant_id, status);
