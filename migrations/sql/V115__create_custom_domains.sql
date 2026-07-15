DROP TABLE IF EXISTS domain_verification_attempts CASCADE;
DROP TABLE IF EXISTS domain_certificates CASCADE;
DROP TABLE IF EXISTS custom_domains CASCADE;

CREATE TABLE custom_domains (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  domain             VARCHAR(255) NOT NULL,
  status             VARCHAR(30) NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','verified','active','failed','removed')),
  verification_type  VARCHAR(20) NOT NULL CHECK (verification_type IN ('cname','txt')),
  verification_token TEXT NOT NULL,
  verified_at        TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at         TIMESTAMP WITH TIME ZONE,
  UNIQUE(domain) -- Global uniqueness constraint across all tenants
);

CREATE TABLE domain_certificates (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  domain_id       UUID NOT NULL REFERENCES custom_domains(id) ON DELETE CASCADE,
  status          VARCHAR(30) NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','expiring','expired','revoked')),
  issued_at       TIMESTAMP WITH TIME ZONE,
  expires_at      TIMESTAMP WITH TIME ZONE,
  auto_renew      BOOLEAN DEFAULT true NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE domain_verification_attempts (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  domain_id     UUID NOT NULL REFERENCES custom_domains(id) ON DELETE CASCADE,
  result        VARCHAR(20) NOT NULL CHECK (result IN ('success','failure','timeout')),
  attempted_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  detail        TEXT
);

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_verification_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_domains ON custom_domains USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_certs ON domain_certificates USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_attempts ON domain_verification_attempts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_custom_domains_tenant_status ON custom_domains(tenant_id, status);
CREATE INDEX idx_certificates_expiry ON domain_certificates(expires_at);
CREATE INDEX idx_verification_attempts_domain ON domain_verification_attempts(domain_id, attempted_at DESC);
