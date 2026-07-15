DROP TABLE IF EXISTS tenant_locale_config CASCADE;
DROP TABLE IF EXISTS locale_preferences CASCADE;

CREATE TABLE locale_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    locale VARCHAR(20) NOT NULL,
    timezone VARCHAR(100),
    UNIQUE(tenant_id, user_id)
);

CREATE TABLE tenant_locale_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    default_theme VARCHAR(20) NOT NULL DEFAULT 'en',
    enforce_theme BOOLEAN DEFAULT false,
    UNIQUE(tenant_id)
);

ALTER TABLE locale_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_locale_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON locale_preferences USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON tenant_locale_config USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
