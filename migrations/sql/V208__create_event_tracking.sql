CREATE TABLE tracked_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  event_name   VARCHAR(150) NOT NULL,
  properties   JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tracked_events_tenant_created ON tracked_events(tenant_id, created_at DESC);
CREATE INDEX idx_tracked_events_tenant_name ON tracked_events(tenant_id, event_name);

ALTER TABLE tracked_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tracked_events ON tracked_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
