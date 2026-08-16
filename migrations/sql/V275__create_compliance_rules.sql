-- V275__create_compliance_rules.sql
--
-- Versioned Compliance Rule Engine — the last missing piece of NB OS's
-- shared spine. A rule's definition can change over time, but evaluating
-- a 2024 event must always use the 2024 version of the rule, even when
-- reviewed years later. compliance_rule_versions is hash-chained per
-- rule so the rule history itself is tamper-evident.

CREATE TABLE IF NOT EXISTS compliance_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  rule_key    VARCHAR(150) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, rule_key)
);

CREATE TABLE IF NOT EXISTS compliance_rule_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  rule_id         UUID NOT NULL REFERENCES compliance_rules(id),
  version_number  INTEGER NOT NULL,
  effective_date  DATE NOT NULL,
  definition      JSONB NOT NULL,
  previous_hash   VARCHAR(64) NOT NULL,
  hash            VARCHAR(64) NOT NULL,
  created_by      UUID NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rule_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_compliance_rule_versions_lookup
  ON compliance_rule_versions(rule_id, effective_date DESC);

ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rule_versions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'compliance_rules' AND policyname = 'tenant_isolation_compliance_rules'
  ) THEN
    CREATE POLICY tenant_isolation_compliance_rules ON compliance_rules
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'compliance_rule_versions' AND policyname = 'tenant_isolation_compliance_rule_versions'
  ) THEN
    CREATE POLICY tenant_isolation_compliance_rule_versions ON compliance_rule_versions
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;
