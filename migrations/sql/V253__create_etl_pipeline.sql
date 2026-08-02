CREATE TABLE etl_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  source        VARCHAR(150) NOT NULL,
  destination   VARCHAR(150) NOT NULL,
  schedule_cron VARCHAR(100),
  status        VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'failed')),
  last_run_at   TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_etl_jobs_tenant_user ON etl_jobs(tenant_id, user_id, created_at DESC);

ALTER TABLE etl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_etl_jobs ON etl_jobs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
