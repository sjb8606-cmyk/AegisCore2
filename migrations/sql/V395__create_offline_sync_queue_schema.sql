CREATE TABLE IF NOT EXISTS pending_write (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  client_timestamp TIMESTAMPTZ NOT NULL,
  sync_status TEXT NOT NULL,
  retries INT NOT NULL DEFAULT 0,
  last_error TEXT,
  server_version INT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_idempotency
  ON pending_write(tenant_id, idempotency_key);
CREATE TABLE IF NOT EXISTS sync_server_entity (
  tenant_id UUID NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  data JSONB NOT NULL,
  version INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, entity, entity_id)
);
