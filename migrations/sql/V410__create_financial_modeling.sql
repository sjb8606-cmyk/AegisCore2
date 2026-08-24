-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS financial_scenarios CASCADE;
DROP TABLE IF EXISTS financial_models CASCADE;

CREATE TABLE financial_models (
  id                       UUID PRIMARY KEY,
  tenant_id                UUID NOT NULL,
  idea_id                  UUID NOT NULL,
  currency                 VARCHAR(3) NOT NULL DEFAULT 'CAD',
  startup_costs            JSONB NOT NULL DEFAULT '{}',
  operating_costs          JSONB NOT NULL DEFAULT '{}',
  revenue_assumptions      JSONB NOT NULL DEFAULT '{}',
  break_even_month         INTEGER,
  break_even_revenue       NUMERIC(14,2),
  twelve_month_net         NUMERIC(14,2),
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE financial_scenarios (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  model_id            UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,
  variable_overrides  JSONB NOT NULL DEFAULT '{}',
  break_even_month    INTEGER,
  break_even_revenue  NUMERIC(14,2),
  twelve_month_net    NUMERIC(14,2),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE financial_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_financial_models ON financial_models USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_financial_scenarios ON financial_scenarios USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_financial_models_idea ON financial_models(tenant_id, idea_id);
CREATE INDEX IF NOT EXISTS idx_financial_models_quota ON financial_models(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_scenarios_model ON financial_scenarios(model_id);
