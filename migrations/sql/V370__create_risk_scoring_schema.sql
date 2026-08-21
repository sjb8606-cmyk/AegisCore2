CREATE TABLE IF NOT EXISTS agent_risk_scores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  run_id TEXT NOT NULL,
  step INT NOT NULL,
  score NUMERIC NOT NULL,
  factors JSONB NOT NULL,
  label TEXT NOT NULL,
  gate_fired BOOLEAN NOT NULL,
  decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_risk_scores_run
  ON agent_risk_scores(tenant_id, run_id, step);
