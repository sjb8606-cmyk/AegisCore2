CREATE TABLE analytics_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  event_name      VARCHAR(100) NOT NULL,
  properties      JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Hardening (V3.6 Doctrine)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;

CREATE POLICY analytics_tenant_isolation ON analytics_events 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- High-Speed Indexing for Time-Series Queries
CREATE INDEX idx_analytics_lookup ON analytics_events(tenant_id, event_name, created_at DESC);
