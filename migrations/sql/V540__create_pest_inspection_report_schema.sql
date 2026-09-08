CREATE TABLE pest_inspection_reports (
  report_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  pest_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN (
      'low',
      'moderate',
      'high',
      'infestation'
    )
  ),
  locations_found JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_treatment_plan TEXT NOT NULL,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pest_inspection_reports_tenant_visit
  ON pest_inspection_reports (tenant_id, visit_id);

CREATE INDEX idx_pest_inspection_reports_tenant_follow_up
  ON pest_inspection_reports (tenant_id, follow_up_date);

ALTER TABLE pest_inspection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE pest_inspection_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pest_inspection_reports
  ON pest_inspection_reports
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
