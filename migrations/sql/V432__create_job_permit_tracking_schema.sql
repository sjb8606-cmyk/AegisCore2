CREATE TABLE job_permit_tracking (
  permit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  permit_type TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'not_required',
      'pending',
      'pulled',
      'inspection_scheduled',
      'passed',
      'failed'
    )
  ),
  permit_number TEXT,
  issued_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_permit_tracking_tenant_job
  ON job_permit_tracking (
    tenant_id,
    job_id
  );

CREATE INDEX idx_job_permit_tracking_tenant_expiry
  ON job_permit_tracking (
    tenant_id,
    expiry_date
  );

ALTER TABLE job_permit_tracking
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE job_permit_tracking
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_job_permit_tracking
  ON job_permit_tracking
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
