CREATE TABLE IF NOT EXISTS consent_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  contract_id UUID NOT NULL,
  consent_text_hash TEXT NOT NULL,
  geo_lat DOUBLE PRECISION,
  geo_lng DOUBLE PRECISION,
  device_meta JSONB,
  chain_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consent_events_contract ON consent_events(tenant_id, contract_id);
