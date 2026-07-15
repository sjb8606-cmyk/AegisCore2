CREATE TABLE IF NOT EXISTS compliance_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(50) CHECK (type IN ('gdpr','ccpa','soc2','iso27001','custom')),
  definition      JSONB NOT NULL,
  active          BOOLEAN DEFAULT true,
  version         VARCHAR(20),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  policy_id       UUID REFERENCES compliance_policies(id),
  entity_type     VARCHAR(50),
  entity_id       UUID,
  status          VARCHAR(30) CHECK (status IN ('pass','fail','warning')),
  risk_score      NUMERIC(5,2),
  details         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  report_type     VARCHAR(50),
  summary         TEXT,
  risk_score      NUMERIC(5,2),
  findings        JSONB,
  generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  source            VARCHAR(100),
  text              VARCHAR(255),
  change_summary    TEXT,
  impact_level      NUMERIC(5,2),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_remediations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  issue_id          UUID,
  recommendation    TEXT NOT NULL,
  status            VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE compliance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_checks FORCE ROW LEVEL SECURITY;

ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports FORCE ROW LEVEL SECURITY;

ALTER TABLE regulatory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_events FORCE ROW LEVEL SECURITY;

ALTER TABLE compliance_remediations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_remediations FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_policies ON compliance_policies 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_checks ON compliance_checks 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_reports ON compliance_reports 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_events ON regulatory_events 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_remediations ON compliance_remediations 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON compliance_policies(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_checks_tenant ON compliance_checks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_tenant ON compliance_reports(tenant_id, generated_at DESC);
