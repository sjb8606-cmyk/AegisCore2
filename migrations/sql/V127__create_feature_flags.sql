DROP TABLE IF EXISTS flag_overrides CASCADE;
DROP TABLE IF EXISTS flag_targeting_rules CASCADE;
DROP TABLE IF EXISTS feature_flags CASCADE;

CREATE TABLE feature_flags (
    id            UUID PRIMARY KEY,
    tenant_id     UUID, -- NULL indicates global platform-wide fallback flag
    key           VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    flag_type     VARCHAR(20) NOT NULL CHECK (flag_type IN ('boolean', 'string', 'number', 'json')),
    default_value JSONB NOT NULL,
    status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived', 'killed')),
    environment   VARCHAR(20) DEFAULT 'all' CHECK (environment IN ('development', 'staging', 'production', 'all')),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, key, environment)
);

CREATE TABLE flag_targeting_rules (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    flag_id      UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    rule_type    VARCHAR(30) NOT NULL CHECK (rule_type IN ('tenant_match','user_match','percentage_rollout','attribute_match')),
    rule_config  JSONB NOT NULL,
    return_value JSONB NOT NULL,
    priority     INTEGER NOT NULL DEFAULT 0,
    active       BOOLEAN DEFAULT true,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE flag_overrides (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL,
    flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    override_type VARCHAR(20) NOT NULL CHECK (override_type IN ('tenant', 'user')),
    target_id     UUID NOT NULL,
    value         JSONB NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, flag_id, override_type, target_id)
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE flag_targeting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE flag_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_flags ON feature_flags USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_rules ON flag_targeting_rules USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_overrides ON flag_overrides USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_feature_flags_tenant_key ON feature_flags(tenant_id, key);
CREATE INDEX idx_flag_rules_flag_priority ON flag_targeting_rules(flag_id, priority DESC);
CREATE INDEX idx_flag_overrides_target ON flag_overrides(flag_id, override_type, target_id);
