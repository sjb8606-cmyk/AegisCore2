DROP TABLE IF EXISTS dep_notices CASCADE;
DROP TABLE IF EXISTS dep_usage_events CASCADE;
DROP TABLE IF EXISTS dep_rules CASCADE;

CREATE TABLE dep_rules (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  surface_name        VARCHAR(255) NOT NULL,
  deprecated_at       TIMESTAMP WITH TIME ZONE NOT NULL,
  hard_cutoff_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  grace_days_override INTEGER DEFAULT 0 NOT NULL,
  migration_guide_url TEXT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, surface_name)
);

CREATE TABLE dep_usage_events (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  rule_id            UUID NOT NULL REFERENCES dep_rules(id) ON DELETE CASCADE,
  client_fingerprint VARCHAR(255) NOT NULL,
  payload_size_bytes INTEGER DEFAULT 0 NOT NULL,
  called_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dep_notices (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  rule_id         UUID NOT NULL REFERENCES dep_rules(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255) NOT NULL,
  sent_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE dep_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dep_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dep_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rules ON dep_rules USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_events ON dep_usage_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_notices ON dep_notices USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_dep_rules_lookup ON dep_rules(tenant_id, surface_name);
CREATE INDEX IF NOT EXISTS idx_dep_events_lookup ON dep_usage_events(rule_id, called_at DESC);
