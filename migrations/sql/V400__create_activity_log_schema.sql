CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  measurements JSONB NOT NULL DEFAULT '[]',
  photos JSONB NOT NULL DEFAULT '[]',
  checklist_results JSONB NOT NULL DEFAULT '[]',
  logged_by TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_log_job
  ON activity_log(tenant_id, job_id);
