CREATE TABLE IF NOT EXISTS data_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  asset_type        VARCHAR(50) NOT NULL,
  asset_id          UUID,
  classification    VARCHAR(50),
  sensitivity       INTEGER DEFAULT 0, -- 0-100
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_lineage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  source_asset_id   UUID NOT NULL,
  target_asset_id   UUID NOT NULL,
  transformation    TEXT,
  flow_context      JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              VARCHAR(255) NOT NULL,
  rule              JSONB NOT NULL,
  action            VARCHAR(30) CHECK (action IN ('allow','deny','mask','encrypt','redact')),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_access_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID,
  asset_id          UUID,
  action            VARCHAR(30),
  policy_applied    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_exports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  asset_id          UUID,
  export_type       VARCHAR(30),
  record_count      INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE data_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_assets FORCE ROW LEVEL SECURITY;

ALTER TABLE data_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_lineage FORCE ROW LEVEL SECURITY;

ALTER TABLE data_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_assets ON data_assets 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_lineage ON data_lineage 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policies ON data_policies 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_logs ON data_access_logs 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_exports ON data_exports 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_assets_tenant ON data_assets(tenant_id, classification);
CREATE INDEX IF NOT EXISTS idx_lineage_source ON data_lineage(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON data_access_logs(user_id, created_at);
