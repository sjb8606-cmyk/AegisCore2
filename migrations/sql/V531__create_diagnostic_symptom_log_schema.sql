CREATE TABLE diagnostic_symptom_log (
  diagnosis_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  appliance_id UUID NOT NULL,
  reported_symptoms TEXT NOT NULL,
  diagnosed_issue TEXT,
  repair_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  replacement_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diagnostic_symptom_log_tenant_appliance
  ON diagnostic_symptom_log (
    tenant_id,
    appliance_id
  );

CREATE INDEX idx_diagnostic_symptom_log_tenant_job
  ON diagnostic_symptom_log (
    tenant_id,
    job_id
  );

ALTER TABLE diagnostic_symptom_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE diagnostic_symptom_log
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_diagnostic_symptom_log
  ON diagnostic_symptom_log
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
