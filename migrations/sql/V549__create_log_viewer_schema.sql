-- @platform/log-viewer — queryable application / audit log index
-- Note: this is a query surface over stored events; writers may also
-- emit into platform audit. This table is the searchable index.

CREATE TABLE IF NOT EXISTS app_log_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id        UUID,
  actor_type      VARCHAR(30) DEFAULT 'user',
  action          VARCHAR(120) NOT NULL,
  resource_type   VARCHAR(80),
  resource_id     UUID,
  outcome         VARCHAR(20) NOT NULL DEFAULT 'success'
                    CHECK (outcome IN ('success','failure','denied')),
  message         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  ip_address      INET,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_log_tenant_time
  ON app_log_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_log_actor
  ON app_log_events (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_log_action
  ON app_log_events (tenant_id, action, occurred_at DESC);

ALTER TABLE app_log_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_app_log ON app_log_events;
CREATE POLICY tenant_isolation_app_log ON app_log_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
