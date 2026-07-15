DROP TABLE IF EXISTS ins_claims CASCADE;
DROP TABLE IF EXISTS ins_policies CASCADE;
DROP TABLE IF EXISTS ins_holders CASCADE;

CREATE TABLE ins_holders (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  first_name     VARCHAR(255) NOT NULL,
  last_name      VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  risk_profile   VARCHAR(50) DEFAULT 'standard' CHECK (risk_profile IN ('low', 'standard', 'high', 'uninsurable')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ins_policies (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  holder_id         UUID NOT NULL REFERENCES ins_holders(id) ON DELETE CASCADE,
  policy_number     VARCHAR(100) NOT NULL UNIQUE,
  policy_type       VARCHAR(100) NOT NULL,
  premium_cents     BIGINT NOT NULL,
  coverage_limit    BIGINT NOT NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('underwriting', 'active', 'suspended', 'canceled', 'expired')),
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ins_claims (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  policy_id         UUID NOT NULL REFERENCES ins_policies(id) ON DELETE CASCADE,
  claim_number      VARCHAR(100) NOT NULL UNIQUE,
  incident_date     DATE NOT NULL,
  description       TEXT NOT NULL,
  amount_cents      BIGINT NOT NULL,
  risk_score        NUMERIC(3,2) DEFAULT 1.00 NOT NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected', 'paid')),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ins_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_holders ON ins_holders USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_policies ON ins_policies USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_claims ON ins_claims USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_ins_policies_holder ON ins_policies(holder_id, status);
CREATE INDEX IF NOT EXISTS idx_ins_claims_policy ON ins_claims(policy_id, status);
CREATE INDEX IF NOT EXISTS idx_ins_claims_number ON ins_claims(claim_number);
