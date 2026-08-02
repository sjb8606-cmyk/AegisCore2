CREATE TABLE tax_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  jurisdiction  VARCHAR(100) NOT NULL,
  rate_percent  NUMERIC NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  applies_to    VARCHAR(100) NOT NULL DEFAULT 'all',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, jurisdiction, applies_to)
);

CREATE INDEX idx_tax_rules_tenant_jurisdiction ON tax_rules(tenant_id, jurisdiction);

ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tax_rules ON tax_rules
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
