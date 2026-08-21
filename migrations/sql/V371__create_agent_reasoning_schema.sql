CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step INT NOT NULL DEFAULT 0,
  max_steps INT NOT NULL,
  mission_phase TEXT,
  budget_used_usd NUMERIC NOT NULL DEFAULT 0,
  allowed_tools JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hitl_approvals (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  step INT NOT NULL,
  decision TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id, status);
