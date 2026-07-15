CREATE TABLE IF NOT EXISTS esign_contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  title             VARCHAR(255) NOT NULL,
  template_id       UUID,
  body              TEXT NOT NULL,
  status            VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'executed', 'voided', 'expired')),
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS esign_contract_signatories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contract_id       UUID NOT NULL REFERENCES esign_contracts(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  role              VARCHAR(30) DEFAULT 'signer' CHECK (role IN ('signer', 'witness', 'approver')),
  sign_token        UUID NOT NULL DEFAULT gen_random_uuid(),
  signed_at         TIMESTAMPTZ,
  signature_data    TEXT,
  ip_address        VARCHAR(45),
  user_agent        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE esign_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_contracts FORCE ROW LEVEL SECURITY;

ALTER TABLE esign_contract_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_contract_signatories FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_esign_contracts ON esign_contracts 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_esign_signatories ON esign_contract_signatories 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_esign_contracts_tenant ON esign_contracts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_esign_signatories_lookup ON esign_contract_signatories(contract_id, email);
CREATE INDEX IF NOT EXISTS idx_esign_signatories_token ON esign_contract_signatories(sign_token);
