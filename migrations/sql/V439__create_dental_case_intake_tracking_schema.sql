CREATE TABLE IF NOT EXISTS dental_cases (
  case_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  dentist_client_id UUID NOT NULL,

  -- Deliberately coded/anonymized reference.
  -- Do not store full patient PHI in this core.
  patient_reference TEXT NOT NULL,

  case_type TEXT NOT NULL CHECK (
    case_type IN (
      'crown',
      'denture',
      'implant',
      'bridge',
      'other'
    )
  ),

  intake_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,

  production_stage TEXT NOT NULL CHECK (
    production_stage IN (
      'intake',
      'design',
      'milling_fabrication',
      'quality_check',
      'shipped'
    )
  ),

  rush_order BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dental_cases
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE dental_cases
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dental_cases
  ON dental_cases
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE INDEX IF NOT EXISTS
  idx_dental_cases_dentist
  ON dental_cases (
    tenant_id,
    dentist_client_id
  );

CREATE INDEX IF NOT EXISTS
  idx_dental_cases_due_date
  ON dental_cases (
    tenant_id,
    due_date
  );

CREATE INDEX IF NOT EXISTS
  idx_dental_cases_stage
  ON dental_cases (
    tenant_id,
    production_stage
  );

CREATE INDEX IF NOT EXISTS
  idx_dental_cases_rush
  ON dental_cases (
    tenant_id,
    rush_order,
    due_date
  );
