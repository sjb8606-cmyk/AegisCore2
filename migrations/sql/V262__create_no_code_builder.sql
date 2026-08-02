CREATE TABLE no_code_apps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  definition    JSONB NOT NULL DEFAULT '{}',
  published     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_no_code_apps_tenant_user ON no_code_apps(tenant_id, user_id, created_at DESC);

ALTER TABLE no_code_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_code_apps FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_no_code_apps ON no_code_apps
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
