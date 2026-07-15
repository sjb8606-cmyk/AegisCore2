CREATE TABLE IF NOT EXISTS threat_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID,
  event_type          VARCHAR(50) NOT NULL,
  risk_score          NUMERIC(5,2) DEFAULT 0.0,
  ip_address          TEXT,
  device_fingerprint  TEXT,
  geo_location        TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_baselines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID,
  baseline_data       JSONB NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  severity            VARCHAR(20) CHECK (severity IN ('low','medium','high','critical')),
  status              VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','escalated')),
  description         TEXT NOT NULL,
  triggered_by        TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_lockdowns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  scope               VARCHAR(50),
  reason              TEXT,
  active              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  released_at         TIMESTAMPTZ
);

-- Row Level Security Activation
ALTER TABLE threat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_events FORCE ROW LEVEL SECURITY;

ALTER TABLE threat_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_baselines FORCE ROW LEVEL SECURITY;

ALTER TABLE threat_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_alerts FORCE ROW LEVEL SECURITY;

ALTER TABLE threat_lockdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_lockdowns FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_events ON threat_events 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_baselines ON threat_baselines 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_alerts ON threat_alerts 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_lockdowns ON threat_lockdowns 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_threat_events_tenant ON threat_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threat_events_risk ON threat_events(tenant_id, risk_score);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON threat_alerts(tenant_id, severity, status);
