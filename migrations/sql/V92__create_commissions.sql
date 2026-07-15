-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS commission_payouts CASCADE;
DROP TABLE IF EXISTS commission_records CASCADE;
DROP TABLE IF EXISTS commission_rules CASCADE;
DROP TABLE IF EXISTS commission_plans CASCADE;

CREATE TABLE commission_plans (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, name)
);

CREATE TABLE commission_rules (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  plan_id         UUID NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  rate_percent    NUMERIC NOT NULL CHECK (rate_percent >= 0),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE commission_records (
  id                      UUID PRIMARY KEY,
  tenant_id               UUID NOT NULL,
  rule_id                 UUID REFERENCES commission_rules(id) ON DELETE SET NULL,
  agent_id                UUID NOT NULL,
  transaction_id          UUID NOT NULL,
  revenue_amount_cents    BIGINT NOT NULL,
  commission_amount_cents BIGINT NOT NULL,
  status                  VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','clawed_back')),
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE commission_payouts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  batch_id        UUID NOT NULL,
  agent_id        UUID NOT NULL,
  amount_cents    BIGINT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_plans ON commission_plans USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_rules ON commission_rules USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_records ON commission_records USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_payouts ON commission_payouts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_com_plans_tenant ON commission_plans(tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_com_rules_plan ON commission_rules(plan_id);
CREATE INDEX IF NOT EXISTS idx_com_records_agent ON commission_records(tenant_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_com_payouts_batch ON commission_payouts(tenant_id, batch_id);
