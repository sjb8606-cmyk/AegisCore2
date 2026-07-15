-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS api_requests CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  key_hash        VARCHAR(64) NOT NULL,
  key_prefix      VARCHAR(12) NOT NULL,
  scopes          TEXT[] DEFAULT '{"read"}',
  ip_whitelist    INET[] DEFAULT '{}',
  rate_limit      INTEGER NOT NULL,
  expires_at      TIMESTAMP WITH TIME ZONE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, key_hash)
);

CREATE TABLE api_requests (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  key_id          UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  method          VARCHAR(10) NOT NULL,
  path            VARCHAR(512) NOT NULL,
  status_code     INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_keys ON api_keys USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_api_reqs ON api_requests USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id, key_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_reqs_tenant ON api_requests(tenant_id, created_at DESC);
