CREATE TABLE experiments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  name        VARCHAR(255) NOT NULL,
  variants    JSONB NOT NULL DEFAULT '[]',
  status      VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
  started_at  TIMESTAMP WITH TIME ZONE,
  ended_at    TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_experiments_tenant_user ON experiments(tenant_id, user_id, created_at DESC);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_experiments ON experiments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
