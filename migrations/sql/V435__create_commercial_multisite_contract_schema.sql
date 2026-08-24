CREATE TABLE commercial_multisite_contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  client_id UUID NOT NULL,
  sites JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_commercial_multisite_contract_tenant_contract
  ON commercial_multisite_contracts (tenant_id, contract_id);

CREATE INDEX idx_commercial_multisite_contracts_tenant_client
  ON commercial_multisite_contracts (tenant_id, client_id);

ALTER TABLE commercial_multisite_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_multisite_contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_commercial_multisite_contracts
  ON commercial_multisite_contracts
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
