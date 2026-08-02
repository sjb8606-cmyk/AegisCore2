CREATE TABLE tax_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL CHECK (period_end >= period_start),
  jurisdiction   VARCHAR(100) NOT NULL,
  total_tax_cents BIGINT NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  filed_at       TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_tax_reports_tenant_period ON tax_reports(tenant_id, period_start DESC);

ALTER TABLE tax_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tax_reports ON tax_reports
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
