CREATE TABLE cohort_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  criteria     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cohort_definitions_tenant_user ON cohort_definitions(tenant_id, user_id, created_at DESC);

ALTER TABLE cohort_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cohort_definitions ON cohort_definitions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
