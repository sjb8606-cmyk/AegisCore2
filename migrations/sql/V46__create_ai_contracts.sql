CREATE TABLE IF NOT EXISTS contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  title             VARCHAR(255),
  raw_text          TEXT NOT NULL,
  document_type     VARCHAR(50),
  version           INTEGER DEFAULT 1,
  status            VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','active','expired','terminated')),
  effective_date    TIMESTAMPTZ,
  expiry_date       TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_clauses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contract_id       UUID NOT NULL REFERENCES contracts(id),
  clause_type       VARCHAR(50),
  clause_text       TEXT,
  risk_score        NUMERIC(5,2),
  is_critical       BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_obligations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contract_id       UUID NOT NULL REFERENCES contracts(id),
  party             VARCHAR(255),
  obligation        TEXT,
  due_date          TIMESTAMPTZ,
  status            VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','breached')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_risks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contract_id       UUID NOT NULL REFERENCES contracts(id),
  risk_type         VARCHAR(50),
  severity          NUMERIC(5,2),
  description       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contract_id       UUID NOT NULL REFERENCES contracts(id),
  version_number    INTEGER,
  diff_summary      JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clauses FORCE ROW LEVEL SECURITY;

ALTER TABLE contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_obligations FORCE ROW LEVEL SECURITY;

ALTER TABLE contract_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_risks FORCE ROW LEVEL SECURITY;

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_versions FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_contracts ON contracts 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_clauses ON contract_clauses 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_obligations ON contract_obligations 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_risks ON contract_risks 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_versions ON contract_versions 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_clauses_contract ON contract_clauses(contract_id);
CREATE INDEX IF NOT EXISTS idx_obligations_contract ON contract_obligations(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_risks_contract ON contract_risks(contract_id, severity);
