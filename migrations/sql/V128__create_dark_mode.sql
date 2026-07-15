-- Idempotency guards
DROP TABLE IF EXISTS tenant_theme_config CASCADE;
DROP TABLE IF EXISTS theme_preferences CASCADE;

-- Core Preferences Table
CREATE TABLE theme_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    preference VARCHAR(20) NOT NULL CHECK (preference IN ('light', 'dark', 'system')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

-- Tenant Policy Configuration Table
CREATE TABLE tenant_theme_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    default_theme VARCHAR(20) NOT NULL DEFAULT 'system' CHECK (default_theme IN ('light', 'dark', 'system')),
    enforce_theme BOOLEAN DEFAULT false,
    token_overrides JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id)
);

-- Performance Indexes
CREATE INDEX idx_theme_preferences_user ON theme_preferences(tenant_id, user_id);

-- Enforce Strict Row-Level Security
ALTER TABLE theme_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_prefs ON theme_preferences
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_config ON tenant_theme_config
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
