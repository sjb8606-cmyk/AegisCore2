CREATE TABLE IF NOT EXISTS brand_compliance_checklists (
  checklist_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  checklist_template_id UUID NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  audit_date TIMESTAMPTZ NOT NULL,
  auditor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brand_compliance_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_compliance_checklists FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_brand_compliance_checklists
  ON brand_compliance_checklists
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_brand_compliance_location
  ON brand_compliance_checklists (
    tenant_id,
    location_id
  );

CREATE INDEX IF NOT EXISTS idx_brand_compliance_audit_date
  ON brand_compliance_checklists (
    tenant_id,
    audit_date
  );
