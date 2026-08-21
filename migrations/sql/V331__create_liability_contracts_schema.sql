CREATE TABLE IF NOT EXISTS liability_contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  niche TEXT NOT NULL,
  party_a_id TEXT NOT NULL,
  party_b_id TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL,
  terms_text TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  signature TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  consent_event_id UUID,
  chain_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_liability_contracts_tenant ON liability_contracts(tenant_id, niche, status);
