CREATE TABLE activity_feed_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  actor_id     UUID NOT NULL,
  verb         VARCHAR(100) NOT NULL,
  object_type  VARCHAR(100) NOT NULL,
  object_id    UUID NOT NULL,
  summary      TEXT NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_feed_tenant_created ON activity_feed_entries(tenant_id, created_at DESC);

ALTER TABLE activity_feed_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feed_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_activity_feed ON activity_feed_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
