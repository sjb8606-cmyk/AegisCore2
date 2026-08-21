CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  portfolio_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market',
  limit_price NUMERIC,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  approved_by TEXT,
  rejected_by TEXT,
  submitted_at TIMESTAMPTZ NOT NULL,
  filled_at TIMESTAMPTZ,
  fill_price NUMERIC,
  notional_usd NUMERIC,
  reason TEXT,
  chain_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_portfolio ON orders(portfolio_id, submitted_at);
