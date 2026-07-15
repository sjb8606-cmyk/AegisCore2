-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS custom_domains CASCADE;
DROP TABLE IF EXISTS brand_configs CASCADE;

CREATE TABLE brand_configs (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  app_name        VARCHAR(100),
  tagline         VARCHAR(255),
  logo_url        TEXT,
  favicon_url     TEXT,
  primary_color   VARCHAR(20),
  secondary_color VARCHAR(20),
  accent_color    VARCHAR(20),
  custom_css      TEXT,
  login_bg_url    TEXT,
  support_email   VARCHAR(255),
  show_watermark  BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id)
);

CREATE TABLE custom_domains (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  domain              VARCHAR(255) NOT NULL,
  verification_token  VARCHAR(64) NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','active','failed')),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, domain)
);

ALTER TABLE brand_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_brands ON brand_configs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_domains ON custom_domains USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_brands_tenant ON brand_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_domains_tenant ON custom_domains(tenant_id, status);
