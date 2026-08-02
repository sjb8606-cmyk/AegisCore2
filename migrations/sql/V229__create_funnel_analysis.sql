CREATE TABLE funnel_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  steps        JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_funnel_definitions_tenant_user ON funnel_definitions(tenant_id, user_id, created_at DESC);

ALTER TABLE funnel_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_funnel_definitions ON funnel_definitions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
