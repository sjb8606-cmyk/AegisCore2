CREATE TABLE data_pipelines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  source        VARCHAR(150) NOT NULL,
  destination   VARCHAR(150) NOT NULL,
  transform     JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_data_pipelines_tenant_user ON data_pipelines(tenant_id, user_id, created_at DESC);

ALTER TABLE data_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_pipelines FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_data_pipelines ON data_pipelines
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
