CREATE TABLE IF NOT EXISTS mfa_methods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  type              VARCHAR(30) CHECK (type IN ('totp','webauthn','recovery')),
  secret            TEXT,                    -- Encrypted
  public_key        TEXT,                    -- For WebAuthn
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  method_type       VARCHAR(30),
  challenge         TEXT,
  status            VARCHAR(20) CHECK (status IN ('pending','verified','failed','expired')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  code_hash         TEXT NOT NULL,
  used              BOOLEAN DEFAULT false,
  used_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_device_trust (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  device_fingerprint TEXT NOT NULL,
  trust_score       INTEGER DEFAULT 0,
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, device_fingerprint)
);

-- Row Level Security Activation
ALTER TABLE mfa_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_methods FORCE ROW LEVEL SECURITY;

ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges FORCE ROW LEVEL SECURITY;

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;

ALTER TABLE mfa_device_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_device_trust FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_methods ON mfa_methods 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_challenges ON mfa_challenges 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_recovery ON mfa_recovery_codes 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_trust ON mfa_device_trust 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX idx_mfa_methods_user ON mfa_methods(user_id, is_active);
CREATE INDEX idx_challenges_user ON mfa_challenges(user_id, expires_at);
CREATE INDEX idx_recovery_user ON mfa_recovery_codes(user_id);
