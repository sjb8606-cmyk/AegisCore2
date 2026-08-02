CREATE TABLE automation_triggers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  name           VARCHAR(255) NOT NULL,
  trigger_type   VARCHAR(100) NOT NULL,
  condition      JSONB NOT NULL DEFAULT '{}',
  action         JSONB NOT NULL DEFAULT '{}',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_automation_triggers_tenant_user ON automation_triggers(tenant_id, user_id, created_at DESC);

ALTER TABLE automation_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_triggers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_automation_triggers ON automation_triggers
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
