-- @platform/event-bus — topics, subscriptions, event log, dead letters

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic           VARCHAR(120) NOT NULL,
  handler_key     VARCHAR(120) NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, topic, handler_key)
);

CREATE TABLE IF NOT EXISTS event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic           VARCHAR(120) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  published_by    UUID,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_dead_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        UUID,
  topic           VARCHAR(120) NOT NULL,
  handler_key     VARCHAR(120) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_subs_topic ON event_subscriptions (tenant_id, topic, active);
CREATE INDEX IF NOT EXISTS idx_event_log_tenant ON event_log (tenant_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_dlq_tenant ON event_dead_letters (tenant_id, failed_at DESC);

ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_event_subs ON event_subscriptions;
CREATE POLICY tenant_isolation_event_subs ON event_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_event_log ON event_log;
CREATE POLICY tenant_isolation_event_log ON event_log
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_event_dlq ON event_dead_letters;
CREATE POLICY tenant_isolation_event_dlq ON event_dead_letters
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
