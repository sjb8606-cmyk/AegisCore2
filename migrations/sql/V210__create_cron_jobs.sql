CREATE TABLE scheduled_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  cron_expression   VARCHAR(100) NOT NULL,
  job_type          VARCHAR(100) NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  enabled           BOOLEAN NOT NULL DEFAULT true,
  last_run_at       TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduled_jobs_tenant_user ON scheduled_jobs(tenant_id, user_id, created_at DESC);

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_scheduled_jobs ON scheduled_jobs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
