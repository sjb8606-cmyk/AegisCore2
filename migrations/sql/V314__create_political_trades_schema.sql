CREATE TABLE IF NOT EXISTS tracked_entities (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  role_metadata JSONB NOT NULL DEFAULT '{}',
  followed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disclosed_trades (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_id UUID NOT NULL REFERENCES tracked_entities(id),
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_range TEXT,
  filed_date DATE,
  transaction_date DATE,
  source TEXT NOT NULL,
  conflict_flag BOOLEAN NOT NULL DEFAULT false,
  conflict_reason TEXT,
  sector TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracked_entities_tenant ON tracked_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_disclosed_trades_symbol ON disclosed_trades(tenant_id, symbol);
CREATE INDEX IF NOT EXISTS idx_disclosed_trades_entity ON disclosed_trades(entity_id);
