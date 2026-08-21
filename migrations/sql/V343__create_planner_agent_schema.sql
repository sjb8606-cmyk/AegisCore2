CREATE TABLE IF NOT EXISTS planner_agent_queries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  intent JSONB NOT NULL,
  entity_id UUID,
  match_count INT NOT NULL DEFAULT 0,
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planner_agent_tenant
  ON planner_agent_queries(tenant_id, created_at);
