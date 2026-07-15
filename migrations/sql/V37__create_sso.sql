CREATE TABLE IF NOT EXISTS identity_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20) CHECK (type IN ('saml','oidc')),
  config          JSONB NOT NULL, -- issuer, client_id, certs, etc.
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  external_id     TEXT NOT NULL,
  email           TEXT,
  provider_id     UUID NOT NULL REFERENCES identity_providers(id),
  role            VARCHAR(50),
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, provider_id, external_id)
);

CREATE TABLE IF NOT EXISTS sso_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID,
  provider_id     UUID,
  session_token   TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  provider_id     UUID REFERENCES identity_providers(id),
  certificate     TEXT,
  fingerprint     TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE identity_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_providers FORCE ROW LEVEL SECURITY;

ALTER TABLE sso_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_users FORCE ROW LEVEL SECURITY;

ALTER TABLE sso_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE sso_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_certificates FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_idp ON identity_providers 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_sso_users ON sso_users 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_sessions ON sso_sessions 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_certs ON sso_certificates 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_idp_tenant ON identity_providers(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sso_users_external ON sso_users(tenant_id, external_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sso_sessions(expires_at);
