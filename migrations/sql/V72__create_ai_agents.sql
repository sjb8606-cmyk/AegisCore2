-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS agent_approvals CASCADE;
DROP TABLE IF EXISTS agent_runs CASCADE;
DROP TABLE IF EXISTS agent_definitions CASCADE;

CREATE TABLE agent_definitions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  system_prompt   TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  agent_id      UUID NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','running','waiting_approval','completed','failed')),
  input         TEXT NOT NULL,
  current_step  INTEGER DEFAULT 1,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_approvals (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  run_id         UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number    INTEGER NOT NULL,
  action_payload JSONB NOT NULL DEFAULT '{}',
  status         VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','timed_out')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at    TIMESTAMP WITH TIME ZONE,
  resolved_by    UUID
);

ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_defs ON agent_definitions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_runs ON agent_runs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_approvals ON agent_approvals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_agent_defs_tenant ON agent_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_run ON agent_approvals(run_id);
