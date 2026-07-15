DROP TABLE IF EXISTS residency_compliance_reports CASCADE;
DROP TABLE IF EXISTS residency_violations CASCADE;
DROP TABLE IF EXISTS residency_policy_history CASCADE;
DROP TABLE IF EXISTS tenant_residency_policies CASCADE;
DROP TABLE IF EXISTS residency_regions CASCADE;

CREATE TABLE residency_regions (
  id            UUID PRIMARY KEY,
  region_code   VARCHAR(20) NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL,
  jurisdiction  VARCHAR(50) NOT NULL,
  available     BOOLEAN DEFAULT true NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_residency_policies (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  allowed_regions  VARCHAR(20)[] NOT NULL,
  primary_region   VARCHAR(20) NOT NULL,
  enforcement_mode VARCHAR(20) CHECK (enforcement_mode IN ('enforce','audit','disabled')) NOT NULL,
  updated_by       UUID NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id)
);

CREATE TABLE residency_policy_history (
  id                       UUID PRIMARY KEY,
  tenant_id                UUID NOT NULL,
  policy_id                UUID NOT NULL REFERENCES tenant_residency_policies(id) ON DELETE CASCADE,
  previous_allowed_regions VARCHAR(20)[],
  new_allowed_regions      VARCHAR(20)[] NOT NULL,
  previous_primary_region  VARCHAR(20),
  new_primary_region       VARCHAR(20) NOT NULL,
  changed_by               UUID NOT NULL,
  changed_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE residency_violations (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  violation_type  VARCHAR(50) CHECK (violation_type IN ('cross_region_request','storage_mismatch','routing_failure')) NOT NULL,
  detected_region VARCHAR(20) NOT NULL,
  policy_regions  VARCHAR(20)[] NOT NULL,
  detail          JSONB DEFAULT '{}' NOT NULL,
  detected_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE residency_compliance_reports (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  period_start    TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end      TIMESTAMP WITH TIME ZONE NOT NULL,
  status          VARCHAR(20) CHECK (status IN ('generating','ready','failed')) NOT NULL,
  report_data     JSONB NOT NULL,
  generated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE residency_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_residency_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE residency_policy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE residency_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE residency_compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY operator_read ON residency_regions USING (true);
CREATE POLICY tenant_isolation_policies_res ON tenant_residency_policies USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_history_res ON residency_policy_history USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_violations_res ON residency_violations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_reports_res ON residency_compliance_reports USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_residency_violations_tenant ON residency_violations(tenant_id, detected_at DESC);
CREATE INDEX idx_residency_reports_tenant ON residency_compliance_reports(tenant_id, period_end DESC);
