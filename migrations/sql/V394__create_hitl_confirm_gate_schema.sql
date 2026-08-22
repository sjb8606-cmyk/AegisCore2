CREATE TABLE IF NOT EXISTS confirm_gate (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  prompts JSONB NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_confirm_gate_pending
  ON confirm_gate(tenant_id, status);
