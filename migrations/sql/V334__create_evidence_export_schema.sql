CREATE TABLE IF NOT EXISTS evidence_exports (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  format TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  download_url TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_exports_contract
  ON evidence_exports(tenant_id, contract_id);
