CREATE TABLE IF NOT EXISTS event_project_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL,
  client_id UUID NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  overall_status TEXT NOT NULL DEFAULT 'planning'
    CHECK (
      overall_status IN (
        'planning',
        'confirmed',
        'in_progress',
        'completed'
      )
    ),
  vendors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_project_timeline_event_unique
    UNIQUE (tenant_id, event_id)
);

ALTER TABLE event_project_timeline
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE event_project_timeline
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_event_project_timeline
  ON event_project_timeline
  USING (
    tenant_id =
    current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id =
    current_setting('app.tenant_id', true)::uuid
  );

CREATE INDEX IF NOT EXISTS idx_event_timeline_tenant_client
  ON event_project_timeline (tenant_id, client_id);

CREATE INDEX IF NOT EXISTS idx_event_timeline_event_date
  ON event_project_timeline (tenant_id, event_date);
