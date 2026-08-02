CREATE TABLE custom_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  user_id          UUID NOT NULL,
  name             VARCHAR(255) NOT NULL,
  query_definition JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custom_reports_tenant_user ON custom_reports(tenant_id, user_id, created_at DESC);

ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_reports ON custom_reports
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
