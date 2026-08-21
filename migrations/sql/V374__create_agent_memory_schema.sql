CREATE TABLE IF NOT EXISTS agent_goals (
  run_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  goal_text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_memory_steps (
  id UUID PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  step_number INT NOT NULL,
  decision JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  blocked BOOLEAN NOT NULL DEFAULT false,
  rejected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_steps_run
  ON agent_memory_steps(run_id, step_number);
