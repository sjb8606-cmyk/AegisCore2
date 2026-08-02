CREATE TABLE data_export_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  export_type   VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  file_url      TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_data_export_jobs_tenant_user ON data_export_jobs(tenant_id, user_id, created_at DESC);

ALTER TABLE data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_export_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_data_export_jobs ON data_export_jobs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
