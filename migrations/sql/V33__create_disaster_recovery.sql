CREATE TABLE IF NOT EXISTS dr_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  event_type        VARCHAR(50) CHECK (event_type IN ('failover','failback','incident','simulation','drill')),
  severity          VARCHAR(20) CHECK (severity IN ('low','medium','high','critical')),
  status            VARCHAR(30) DEFAULT 'triggered' CHECK (status IN ('triggered','in_progress','completed','failed','rolled_back')),
  region_from       TEXT,
  region_to         TEXT,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dr_rto_rpo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  service_name      TEXT NOT NULL,
  rto_minutes       INTEGER,
  rpo_minutes       INTEGER,
  last_measured     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dr_runbooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              TEXT NOT NULL,
  steps             JSONB NOT NULL,
  version           INTEGER DEFAULT 1,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dr_dependency_graph (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  service_name      TEXT NOT NULL,
  depends_on        TEXT NOT NULL,
  priority          INTEGER DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dr_readiness (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  score             INTEGER DEFAULT 0,
  last_tested       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE dr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_events FORCE ROW LEVEL SECURITY;

ALTER TABLE dr_rto_rpo ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_rto_rpo FORCE ROW LEVEL SECURITY;

ALTER TABLE dr_runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_runbooks FORCE ROW LEVEL SECURITY;

ALTER TABLE dr_dependency_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_dependency_graph FORCE ROW LEVEL SECURITY;

ALTER TABLE dr_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_readiness FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_events ON dr_events 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_rto_rpo ON dr_rto_rpo 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_runbooks ON dr_runbooks 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_graph ON dr_dependency_graph 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_readiness ON dr_readiness 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_dr_events_tenant ON dr_events(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rto_rpo_service ON dr_rto_rpo(tenant_id, service_name);
CREATE INDEX IF NOT EXISTS idx_dependency_service ON dr_dependency_graph(tenant_id, service_name);
