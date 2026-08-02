CREATE TABLE revenue_splits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  recipients    JSONB NOT NULL DEFAULT '[]',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_revenue_splits_tenant_created ON revenue_splits(tenant_id, created_at DESC);

ALTER TABLE revenue_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_splits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_revenue_splits ON revenue_splits
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
