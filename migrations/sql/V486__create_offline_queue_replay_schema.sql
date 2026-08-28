CREATE TABLE IF NOT EXISTS pos_offline_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_offline_idem
  ON pos_offline_event(tenant_id, device_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pos_offline_status
  ON pos_offline_event(tenant_id, status, created_at);
