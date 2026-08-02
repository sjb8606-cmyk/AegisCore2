CREATE TABLE warehouse_sync_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  destination  VARCHAR(150) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  rows_synced  BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_warehouse_sync_jobs_tenant_user ON warehouse_sync_jobs(tenant_id, user_id, created_at DESC);

ALTER TABLE warehouse_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_sync_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_warehouse_sync_jobs ON warehouse_sync_jobs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
