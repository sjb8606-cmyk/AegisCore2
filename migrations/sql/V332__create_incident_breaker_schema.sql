CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID,
  reporter_id TEXT NOT NULL,
  subject_actor_id TEXT,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  immediate_action_taken TEXT,
  triage_status TEXT NOT NULL,
  auto_suspended BOOLEAN NOT NULL DEFAULT false,
  alerts_fired JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS actor_suspensions (
  actor_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reason TEXT NOT NULL,
  incident_id UUID NOT NULL,
  suspended_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant ON incident_reports(tenant_id, triage_status);
