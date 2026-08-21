CREATE TABLE IF NOT EXISTS backtests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  status TEXT NOT NULL,
  config JSONB NOT NULL,
  result_summary JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backtests_tenant ON backtests(tenant_id, created_at);
