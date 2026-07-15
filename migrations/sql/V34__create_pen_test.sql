CREATE TABLE IF NOT EXISTS security_scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  scan_type         VARCHAR(50) CHECK (scan_type IN ('app','infra','dependency','full')),
  status            VARCHAR(30) DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  score             INTEGER DEFAULT 0,
  findings_count    INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS security_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  scan_id           UUID REFERENCES security_scans(id),
  severity          VARCHAR(20) CHECK (severity IN ('critical','high','medium','low')),
  title             TEXT NOT NULL,
  description       TEXT,
  affected_asset    TEXT,
  cve_id            TEXT,
  status            VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','ignored')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  asset_type        VARCHAR(50),
  identifier        TEXT NOT NULL,
  exposure_score    INTEGER DEFAULT 0,
  last_scanned      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_remediation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  finding_id        UUID REFERENCES security_findings(id),
  action            TEXT,
  status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','rejected')),
  assigned_to       UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE security_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_scans FORCE ROW LEVEL SECURITY;

ALTER TABLE security_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_findings FORCE ROW LEVEL SECURITY;

ALTER TABLE security_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_assets FORCE ROW LEVEL SECURITY;

ALTER TABLE security_remediation ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_remediation FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_scans ON security_scans 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_findings ON security_findings 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_assets ON security_assets 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_remediation ON security_remediation 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX idx_scans_tenant ON security_scans(tenant_id, status);
CREATE INDEX idx_findings_severity ON security_findings(tenant_id, severity, status);
CREATE INDEX idx_assets_tenant ON security_assets(tenant_id);
