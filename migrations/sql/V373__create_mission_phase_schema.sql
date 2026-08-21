CREATE TABLE IF NOT EXISTS agent_missions (
  id UUID PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  mission_type TEXT NOT NULL,
  current_phase_index INT NOT NULL DEFAULT 0,
  phases JSONB NOT NULL,
  completed_criteria JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_missions_run ON agent_missions(run_id);
