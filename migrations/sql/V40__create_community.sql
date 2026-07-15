CREATE TABLE IF NOT EXISTS community_forums (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  slug          VARCHAR(100) NOT NULL,
  is_public     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS community_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  forum_id      UUID NOT NULL REFERENCES community_forums(id),
  user_id       UUID NOT NULL,
  title         VARCHAR(255) NOT NULL,
  content       TEXT,
  pinned        BOOLEAN DEFAULT false,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  thread_id     UUID NOT NULL REFERENCES community_threads(id),
  parent_id     UUID REFERENCES community_comments(id),
  user_id       UUID NOT NULL,
  content       TEXT NOT NULL,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  target_id     UUID NOT NULL,
  target_type   VARCHAR(20) CHECK (target_type IN ('thread','comment')),
  vote          INTEGER CHECK (vote IN (-1, 1)),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, target_id, target_type)
);

CREATE TABLE IF NOT EXISTS community_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  target_id     UUID NOT NULL,
  target_type   VARCHAR(20),
  reason        TEXT,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed','actioned')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_reputation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  score         INTEGER DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Row Level Security Activation
ALTER TABLE community_forums ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_forums FORCE ROW LEVEL SECURITY;

ALTER TABLE community_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_threads FORCE ROW LEVEL SECURITY;

ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments FORCE ROW LEVEL SECURITY;

ALTER TABLE community_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_votes FORCE ROW LEVEL SECURITY;

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reports FORCE ROW LEVEL SECURITY;

ALTER TABLE community_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reputation FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_forums ON community_forums 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_threads ON community_threads 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_comments ON community_comments 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_votes ON community_votes 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_reports ON community_reports 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_reputation ON community_reputation 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_forums_tenant ON community_forums(tenant_id);
CREATE INDEX IF NOT EXISTS idx_threads_forum ON community_threads(forum_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON community_comments(thread_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_votes_target ON community_votes(target_id, target_type);
