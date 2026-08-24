CREATE TABLE single_visit_job_record (
  job_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  request_id UUID NOT NULL,
  client_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  arrival_timestamp TIMESTAMPTZ,
  completion_timestamp TIMESTAMPTZ,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  customer_signature_captured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_single_visit_job_record_tenant_client
  ON single_visit_job_record (
    tenant_id,
    client_id
  );

CREATE INDEX idx_single_visit_job_record_tenant_request
  ON single_visit_job_record (
    tenant_id,
    request_id
  );

ALTER TABLE single_visit_job_record
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE single_visit_job_record
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_single_visit_job_record
  ON single_visit_job_record
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
