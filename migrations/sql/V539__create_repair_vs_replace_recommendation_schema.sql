CREATE TABLE repair_vs_replace_recommendation (
  recommendation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  diagnosis_id UUID NOT NULL,
  repair_cost_estimate NUMERIC(14, 2) NOT NULL
    CHECK (repair_cost_estimate >= 0),
  appliance_age_years NUMERIC(8, 2) NOT NULL
    CHECK (appliance_age_years >= 0),
  replacement_cost_estimate NUMERIC(14, 2) NOT NULL
    CHECK (replacement_cost_estimate > 0),
  recommendation TEXT NOT NULL
    CHECK (
      recommendation IN (
        'repair',
        'replace',
        'client_choice'
      )
    ),
  client_decision TEXT
    CHECK (
      client_decision IS NULL
      OR client_decision IN ('repair', 'replace')
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_repair_replace_recommendation_tenant_diagnosis
  ON repair_vs_replace_recommendation (
    tenant_id,
    diagnosis_id
  );

ALTER TABLE repair_vs_replace_recommendation
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE repair_vs_replace_recommendation
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_repair_vs_replace_recommendation
  ON repair_vs_replace_recommendation
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
