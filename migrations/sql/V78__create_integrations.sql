-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS integration_sync_logs CASCADE;
DROP TABLE IF EXISTS tenant_connections CASCADE;

CREATE TABLE tenant_connections (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  provider          VARCHAR(50) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at  TIMESTAMP WITH TIME ZONE,
  external_id       VARCHAR(255) NOT NULL,
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, provider, external_id)
);

CREATE TABLE integration_sync_logs (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  connection_id     UUID NOT NULL REFERENCES tenant_connections(id) ON DELETE CASCADE,
  status            VARCHAR(20) DEFAULT 'syncing' CHECK (status IN ('success','failed','syncing')),
  records_synced     INTEGER DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at      TIMESTAMP WITH TIME ZONE
);

ALTER TABLE tenant_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_connections ON tenant_connections USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_sync_logs ON integration_sync_logs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_connections_tenant ON tenant_connections(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_sync_logs_tenant ON integration_sync_logs(tenant_id, completed_at DESC);
