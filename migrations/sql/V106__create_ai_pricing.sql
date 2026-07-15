DROP TABLE IF EXISTS pricing_segments CASCADE;
DROP TABLE IF EXISTS pricing_experiments CASCADE;
DROP TABLE IF EXISTS pricing_history CASCADE;
DROP TABLE IF EXISTS pricing_rules CASCADE;

CREATE TABLE pricing_rules (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       UUID,
  rule_type       VARCHAR(50) NOT NULL CHECK (rule_type IN ('base_price','discount','surge','segment','bundle')),
  config          JSONB NOT NULL,
  active          BOOLEAN DEFAULT true NOT NULL,
  priority        INTEGER DEFAULT 0 NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pricing_history (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  entity_id       UUID NOT NULL,
  old_price       NUMERIC(14,2) NOT NULL,
  new_price       NUMERIC(14,2) NOT NULL,
  reason          VARCHAR(255) NOT NULL,
  model_version   VARCHAR(50) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pricing_experiments (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  hypothesis      TEXT,
  variants        JSONB,
  status          VARCHAR(30) DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pricing_segments (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  conditions      JSONB NOT NULL,
  price_modifier  NUMERIC(5,2) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rules ON pricing_rules USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_history ON pricing_history USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_experiments ON pricing_experiments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_segments ON pricing_segments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_rules_tenant ON pricing_rules(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_history_entity ON pricing_history(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_tenant ON pricing_experiments(tenant_id, status);
