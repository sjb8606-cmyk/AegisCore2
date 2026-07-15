CREATE TABLE IF NOT EXISTS email_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  subject           VARCHAR(255),
  status            VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at      TIMESTAMPTZ,
  total_recipients  INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  campaign_id       UUID NOT NULL REFERENCES email_campaigns(id),
  recipient_email   VARCHAR(255) NOT NULL,
  status            VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','opened','clicked','bounced','unsubscribed')),
  sent_at           TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  clicked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  structure         JSONB NOT NULL,
  version           INTEGER DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_audiences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255),
  filters           JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  email             VARCHAR(255) NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS email_bounces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  email             VARCHAR(255) NOT NULL,
  bounce_type       VARCHAR(50),
  reason            TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE email_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_audiences FORCE ROW LEVEL SECURITY;

ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_unsubscribes FORCE ROW LEVEL SECURITY;

ALTER TABLE email_bounces ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_bounces FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_campaigns ON email_campaigns 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_messages ON email_messages 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_templates ON email_templates 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_audiences ON email_audiences 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_unsubscribes ON email_unsubscribes 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_bounces ON email_bounces 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON email_campaigns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON email_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_email ON email_unsubscribes(email);
