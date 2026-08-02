CREATE TABLE kpis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  target_value  NUMERIC NOT NULL,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit          VARCHAR(50),
  period        VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kpis_tenant_user ON kpis(tenant_id, user_id, created_at DESC);

ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_kpis ON kpis
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
