CREATE TABLE IF NOT EXISTS user_skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  skill_name      VARCHAR(255) NOT NULL,
  current_level   NUMERIC(5,2),
  target_level    NUMERIC(5,2),
  last_assessed   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coaching_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  goal_title      VARCHAR(255) NOT NULL,
  description     TEXT,
  progress        NUMERIC(5,2) DEFAULT 0,
  status          VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active','completed','paused','abandoned')),
  due_date        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coaching_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  recommendation    TEXT NOT NULL,
  priority          NUMERIC(5,2),
  category          VARCHAR(50),
  status            VARCHAR(30) DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coaching_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id         UUID NOT NULL,
  session_type    VARCHAR(50),
  insights        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  metric_name     VARCHAR(255),
  value           NUMERIC(5,2),
  trend           NUMERIC(5,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skills FORCE ROW LEVEL SECURITY;

ALTER TABLE coaching_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_goals FORCE ROW LEVEL SECURITY;

ALTER TABLE coaching_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_recommendations FORCE ROW LEVEL SECURITY;

ALTER TABLE coaching_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_skills ON user_skills 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_goals ON coaching_goals 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_recs ON coaching_recommendations 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_sessions ON coaching_sessions 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_metrics ON performance_metrics 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_skills_user ON user_skills(user_id, skill_name);
CREATE INDEX IF NOT EXISTS idx_goals_user ON coaching_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recs_user ON coaching_recommendations(user_id, priority);
