CREATE TABLE IF NOT EXISTS mkt_seller_balance (
  tenant_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  pending_cents BIGINT NOT NULL DEFAULT 0,
  available_cents BIGINT NOT NULL DEFAULT 0,
  paid_cents BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, seller_id)
);
CREATE TABLE IF NOT EXISTS mkt_seller_ledger_entry (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  order_id TEXT,
  available_at TIMESTAMPTZ,
  released BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mkt_seller_payout (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  entry_ids JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
