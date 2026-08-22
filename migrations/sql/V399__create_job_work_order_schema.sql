CREATE TABLE IF NOT EXISTS job (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  entity_ref TEXT,
  description TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  assigned_to TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_job_tenant_status
  ON job(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_job_assignee
  ON job(tenant_id, assigned_to);
