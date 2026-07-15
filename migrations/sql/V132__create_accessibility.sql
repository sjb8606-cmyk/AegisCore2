DROP TABLE IF EXISTS tenant_accessibility_config CASCADE;
DROP TABLE IF EXISTS accessibility_preferences CASCADE;

CREATE TABLE accessibility_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    high_contrast BOOLEAN DEFAULT false,
    reduced_motion BOOLEAN DEFAULT false,
    font_scale NUMERIC(3,1) DEFAULT 1.0 CHECK (font_scale BETWEEN 0.8 AND 2.0),
    screen_reader_hints BOOLEAN DEFAULT false,
    keyboard_nav_mode BOOLEAN DEFAULT false,
    focus_indicator VARCHAR(20) DEFAULT 'default' CHECK (focus_indicator IN ('default', 'high-visibility', 'none')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

CREATE TABLE tenant_accessibility_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    wcag_level VARCHAR(10) DEFAULT 'AA' CHECK (wcag_level IN ('A', 'AA', 'AAA')),
    enforce_high_contrast BOOLEAN DEFAULT false,
    enforce_reduced_motion BOOLEAN DEFAULT false,
    min_font_scale NUMERIC(3,1) DEFAULT 0.8,
    max_font_scale NUMERIC(3,1) DEFAULT 2.0,
    accessibility_statement_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id)
);

CREATE INDEX idx_accessibility_preferences_user ON accessibility_preferences(tenant_id, user_id);

ALTER TABLE accessibility_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_accessibility_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_prefs ON accessibility_preferences USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_config ON tenant_accessibility_config USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
