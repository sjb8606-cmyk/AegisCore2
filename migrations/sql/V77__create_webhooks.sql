-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS webhook_logs CASCADE;
DROP TABLE IF EXISTS webhook_endpoints CASCADE;

CREATE TABLE webhook_endpoints (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  url             VARCHAR(512) NOT NULL,
  description     TEXT,
  secret          VARCHAR(128) NOT NULL,
  events          TEXT[] NOT NULL,
  custom_headers  JSONB DEFAULT '{}',
  status          VARCHAR(20) DEFAULT 'active',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, url)
);

CREATE TABLE webhook_logs (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type      VARCHAR(100) NOT NULL,
  status_code     INTEGER,
  duration_ms     INTEGER,
  response_body   TEXT,
  error_message   TEXT,
  attempt_number  INTEGER NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_endpoints ON webhook_endpoints USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_webhook_logs ON webhook_logs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_tenant ON webhook_logs(tenant_id, created_at DESC);
