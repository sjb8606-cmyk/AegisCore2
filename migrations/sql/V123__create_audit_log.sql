DROP TABLE IF EXISTS audit_events CASCADE;

CREATE TABLE audit_events (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL, -- Removed parent table reference constraint
  sequence       BIGSERIAL NOT NULL,
  event_type     VARCHAR(100) NOT NULL,
  actor_id       UUID,
  actor_type     VARCHAR(50),
  actor_ip       INET,
  actor_ua       TEXT,
  resource_type  VARCHAR(100),
  resource_id    VARCHAR(255),
  action         VARCHAR(100) NOT NULL,
  outcome        VARCHAR(20) CHECK (outcome IN ('success', 'failure', 'partial')) NOT NULL,
  before_state   JSONB DEFAULT '{}' NOT NULL,
  after_state    JSONB DEFAULT '{}' NOT NULL,
  metadata       JSONB DEFAULT '{}' NOT NULL,
  prev_hash      VARCHAR(64) NOT NULL,
  event_hash     VARCHAR(64) NOT NULL,
  occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     TIMESTAMP WITH TIME ZONE
);

-- IMMUTABILITY RULES
CREATE RULE no_update_audit_events AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_events AS ON DELETE TO audit_events DO INSTEAD NOTHING;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit ON audit_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_audit_tenant_occurred ON audit_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_events(tenant_id, actor_id, occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(tenant_id, resource_type, resource_id);
CREATE INDEX idx_audit_event_type ON audit_events(tenant_id, event_type, occurred_at DESC);
