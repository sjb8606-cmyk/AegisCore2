-- @platform/cli-tools — registered CLI commands + execution history

CREATE TABLE IF NOT EXISTS cli_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(80) NOT NULL,
  description     TEXT,
  handler_key     VARCHAR(120) NOT NULL,
  arg_schema      JSONB NOT NULL DEFAULT '{}',
  is_dangerous    BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS cli_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  command_id      UUID REFERENCES cli_commands(id) ON DELETE SET NULL,
  command_name    VARCHAR(80) NOT NULL,
  args            JSONB NOT NULL DEFAULT '{}',
  status          VARCHAR(20) NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending','completed','failed')),
  result          JSONB,
  error_message   TEXT,
  executed_by     UUID,
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cli_commands_tenant ON cli_commands (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_cli_executions_tenant ON cli_executions (tenant_id, executed_at DESC);

ALTER TABLE cli_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE cli_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_cli_commands ON cli_commands;
CREATE POLICY tenant_isolation_cli_commands ON cli_commands
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_cli_executions ON cli_executions;
CREATE POLICY tenant_isolation_cli_executions ON cli_executions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
