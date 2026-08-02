CREATE TABLE rpa_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  target_app    VARCHAR(150) NOT NULL,
  steps         JSONB NOT NULL DEFAULT '[]',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rpa_tasks_tenant_user ON rpa_tasks(tenant_id, user_id, created_at DESC);

ALTER TABLE rpa_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rpa_tasks ON rpa_tasks
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
