CREATE TABLE licensed_technician_dispatch_jobs (
  job_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  required_license_type TEXT NOT NULL CHECK (
    required_license_type IN (
      'hvac',
      'plumbing',
      'electrical',
      'gas_fitting'
    )
  ),
  technician_id UUID,
  scheduled_date TIMESTAMPTZ NOT NULL,
  priority TEXT NOT NULL CHECK (
    priority IN (
      'routine',
      'urgent',
      'emergency'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'unassigned',
      'assigned',
      'in_progress',
      'completed'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_licensed_dispatch_tenant_date
  ON licensed_technician_dispatch_jobs (
    tenant_id,
    scheduled_date
  );

CREATE INDEX idx_licensed_dispatch_tenant_technician_date
  ON licensed_technician_dispatch_jobs (
    tenant_id,
    technician_id,
    scheduled_date
  );

ALTER TABLE licensed_technician_dispatch_jobs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE licensed_technician_dispatch_jobs
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_licensed_technician_dispatch_jobs
  ON licensed_technician_dispatch_jobs
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
