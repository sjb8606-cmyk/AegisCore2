CREATE TABLE IF NOT EXISTS sms_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  message_template  TEXT NOT NULL,
  status            VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','completed','failed')),
  scheduled_at      TIMESTAMPTZ,
  total_recipients  INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  campaign_id       UUID NOT NULL REFERENCES sms_campaigns(id),
  phone_number      VARCHAR(30) NOT NULL,
  status            VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed','opted_out')),
  delivered_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  template          TEXT NOT NULL,
  variables         JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  phone_number      VARCHAR(30) NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone_number)
);

CREATE TABLE IF NOT EXISTS sms_delivery_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  campaign_id       UUID,
  phone_number      VARCHAR(30),
  provider_status   VARCHAR(50),
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE sms_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE sms_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_recipients FORCE ROW LEVEL SECURITY;

ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_opt_outs FORCE ROW LEVEL SECURITY;

ALTER TABLE sms_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_delivery_logs FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_campaigns ON sms_campaigns 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_recipients ON sms_recipients 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_templates ON sms_templates 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_optouts ON sms_opt_outs 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_logs ON sms_delivery_logs 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON sms_campaigns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON sms_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_optouts_phone ON sms_opt_outs(phone_number);
