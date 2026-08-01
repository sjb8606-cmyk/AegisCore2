CREATE TABLE IF NOT EXISTS fisheries_compliance_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  from_date       TIMESTAMPTZ NOT NULL,
  to_date         TIMESTAMPTZ NOT NULL,
  summary         JSONB NOT NULL,
  generated_by    UUID NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fisheries_compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE fisheries_compliance_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_compliance_reports ON fisheries_compliance_reports
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_fisheries_compliance_reports_tenant ON fisheries_compliance_reports(tenant_id, created_at DESC);
