-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS decision_overrides CASCADE;
DROP TABLE IF EXISTS decisions CASCADE;
DROP TABLE IF EXISTS decision_models CASCADE;

CREATE TABLE decision_models (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  name        VARCHAR(255) NOT NULL,
  rules       JSONB NOT NULL DEFAULT '[]',
  weights     JSONB NOT NULL DEFAULT '{}',
  thresholds  JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);

CREATE TABLE decisions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  model_id        UUID NOT NULL REFERENCES decision_models(id) ON DELETE CASCADE,
  input_data      JSONB NOT NULL DEFAULT '{}',
  outcome         VARCHAR(50) NOT NULL,
  confidence      NUMERIC NOT NULL,
  rule_results    JSONB NOT NULL DEFAULT '[]',
  ai_reasoning    TEXT,
  reference_id    VARCHAR(100),
  created_by      UUID NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE decision_overrides (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  decision_id   UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  new_outcome   VARCHAR(50) NOT NULL,
  reason        TEXT NOT NULL,
  resolved_by   UUID NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE decision_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_models ON decision_models USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_decisions ON decisions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_overrides ON decision_overrides USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_models_tenant ON decision_models(tenant_id);
CREATE INDEX IF NOT EXISTS idx_decisions_tenant ON decisions(tenant_id, outcome);
CREATE INDEX IF NOT EXISTS idx_overrides_decision ON decision_overrides(decision_id);
