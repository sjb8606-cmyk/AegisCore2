CREATE TABLE IF NOT EXISTS business_funding_findings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES business_projects(id),
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  url TEXT NULL,
  amount TEXT NULL,
  eligibility JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadlines JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('candidate','verified','ineligible','expired','unknown')),
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_funding_findings_project ON business_funding_findings(tenant_id,project_id,created_at DESC);
ALTER TABLE business_funding_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_funding_findings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_funding_findings_tenant_isolation ON business_funding_findings;
CREATE POLICY business_funding_findings_tenant_isolation ON business_funding_findings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
