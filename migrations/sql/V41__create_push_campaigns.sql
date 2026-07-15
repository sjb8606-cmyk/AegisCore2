CREATE TABLE IF NOT EXISTS push_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  title             VARCHAR(255),
  message           TEXT,
  status            VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at      TIMESTAMPTZ,
  total_recipients  INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID,
  device_token      TEXT NOT NULL,
  platform          VARCHAR(20) CHECK (platform IN ('ios','android','web')),
  is_active         BOOLEAN DEFAULT true,
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, device_token)
);

CREATE TABLE IF NOT EXISTS push_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  campaign_id       UUID NOT NULL REFERENCES push_campaigns(id),
  device_id         UUID NOT NULL REFERENCES push_devices(id),
  status            VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed','muted')),
  delivered_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  muted             BOOLEAN DEFAULT false,
  muted_categories  TEXT[] DEFAULT '{}',
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Row Level Security Activation
ALTER TABLE push_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_devices FORCE ROW LEVEL SECURITY;

ALTER TABLE push_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_recipients FORCE ROW LEVEL SECURITY;

ALTER TABLE push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_preferences FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_campaigns ON push_campaigns 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_devices ON push_devices 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_recipients ON push_recipients 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_preferences ON push_preferences 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON push_campaigns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON push_devices(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON push_recipients(campaign_id, status);
