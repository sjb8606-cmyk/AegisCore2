CREATE TABLE IF NOT EXISTS announcements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  title             VARCHAR(255) NOT NULL,
  message           TEXT NOT NULL,
  type              VARCHAR(20) CHECK (type IN ('info','warning','critical')),
  format            VARCHAR(20) CHECK (format IN ('banner','modal','feed')),
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','expired')),
  priority          INTEGER DEFAULT 1,
  start_at          TIMESTAMPTZ,
  end_at            TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcement_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  announcement_id   UUID NOT NULL REFERENCES announcements(id),
  target_type       VARCHAR(20) CHECK (target_type IN ('user','role','segment','all')),
  target_value      TEXT
);

CREATE TABLE IF NOT EXISTS announcement_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  announcement_id   UUID NOT NULL REFERENCES announcements(id),
  user_id           UUID,
  event_type        VARCHAR(20) CHECK (event_type IN ('viewed','dismissed','clicked')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcement_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  announcement_id   UUID NOT NULL REFERENCES announcements(id),
  variant_key       VARCHAR(50),
  content           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;

ALTER TABLE announcement_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_targets FORCE ROW LEVEL SECURITY;

ALTER TABLE announcement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_events FORCE ROW LEVEL SECURITY;

ALTER TABLE announcement_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_variants FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_announcements ON announcements 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_targets ON announcement_targets 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_events ON announcement_events 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_variants ON announcement_variants 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_announcements_dates ON announcements(start_at, end_at) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_events_user ON announcement_events(user_id, announcement_id);
