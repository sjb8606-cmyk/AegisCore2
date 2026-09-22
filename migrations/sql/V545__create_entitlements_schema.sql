-- Migration: V545__create_entitlements_schema.sql
-- @platform/entitlements — tenant tier assignment + per-tenant feature overrides.

CREATE TABLE tenant_tiers (
  tenant_id     UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tier          VARCHAR(50) NOT NULL DEFAULT 'standard',
  updated_by    UUID,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tenant_feature_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_name   VARCHAR(100) NOT NULL,
  override_key   VARCHAR(100) NOT NULL,
  enabled        BOOLEAN NOT NULL,
  reason         TEXT,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, feature_name, override_key)
);

-- RLS
ALTER TABLE tenant_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tiers ON tenant_tiers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_overrides ON tenant_feature_overrides
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Indexes
CREATE INDEX idx_overrides_tenant_feature ON tenant_feature_overrides(tenant_id, feature_name);
