CREATE TABLE IF NOT EXISTS device_trust (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID NOT NULL,
  device_fingerprint  TEXT NOT NULL,
  trust_score         NUMERIC DEFAULT 0.0,
  last_verified       TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, device_fingerprint)
);

CREATE TABLE IF NOT EXISTS trust_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID NOT NULL,
  session_id          TEXT NOT NULL,
  trust_level         NUMERIC DEFAULT 0.0,
  last_evaluated      TIMESTAMPTZ DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS network_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  name                TEXT NOT NULL,
  rule                JSONB NOT NULL,
  action              VARCHAR(20) CHECK (action IN ('allow','deny','mask','step_up')),
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID,
  event_type          TEXT NOT NULL,
  trust_delta         NUMERIC DEFAULT 0.0,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE device_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_trust FORCE ROW LEVEL SECURITY;

ALTER TABLE trust_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE network_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE trust_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_events FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_device ON device_trust 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_sessions ON trust_sessions 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policies ON network_policies 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_events ON trust_events 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_device_trust_user ON device_trust(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_trust_sessions_user ON trust_sessions(tenant_id, user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_network_policies_tenant ON network_policies(tenant_id, is_active);
