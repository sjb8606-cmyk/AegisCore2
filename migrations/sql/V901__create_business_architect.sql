CREATE TABLE IF NOT EXISTS business_projects (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  current_stage TEXT NOT NULL DEFAULT 'IDEA',
  schema_version TEXT NOT NULL DEFAULT '0.1',
  founder_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  idea JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_problem JSONB NOT NULL DEFAULT '{}'::jsonb,
  market JSONB NOT NULL DEFAULT '{}'::jsonb,
  competition JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  operations JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing JSONB NOT NULL DEFAULT '{}'::jsonb,
  costs JSONB NOT NULL DEFAULT '{}'::jsonb,
  financial_model_ref UUID NULL,
  research_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  funding JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
  deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_business_projects_tenant_updated
  ON business_projects(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_projects_tenant_stage
  ON business_projects(tenant_id, current_stage);

CREATE TABLE IF NOT EXISTS business_stage_history (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES business_projects(id),
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('advance','revisit')),
  completion_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_stage_history_project
  ON business_stage_history(tenant_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business_competitors (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES business_projects(id),
  name TEXT NOT NULL,
  website TEXT NULL,
  description TEXT NOT NULL DEFAULT '',
  offerings JSONB NOT NULL DEFAULT '[]'::jsonb,
  pricing JSONB NOT NULL DEFAULT '{}'::jsonb,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  differentiation JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_tag TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confidence_tag IN ('known','evidence_supported','estimated','assumption','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_competitors_project
  ON business_competitors(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS business_artifacts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES business_projects(id),
  type TEXT NOT NULL CHECK (type IN ('BUSINESS_PLAN','EXECUTIVE_SUMMARY','FUNDING_PACKAGE','LAUNCH_ROADMAP')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current','stale','superseded')),
  content JSONB NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, type, version)
);
CREATE INDEX IF NOT EXISTS idx_business_artifacts_project
  ON business_artifacts(tenant_id, project_id, type, status);

CREATE TABLE IF NOT EXISTS business_stage_data (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES business_projects(id),
  stage TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_business_stage_data_project
  ON business_stage_data(tenant_id, project_id);

ALTER TABLE business_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_stage_data ENABLE ROW LEVEL SECURITY;

ALTER TABLE business_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE business_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE business_competitors FORCE ROW LEVEL SECURITY;
ALTER TABLE business_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE business_stage_data FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_projects_tenant_isolation ON business_projects;
CREATE POLICY business_projects_tenant_isolation ON business_projects
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS business_stage_history_tenant_isolation ON business_stage_history;
CREATE POLICY business_stage_history_tenant_isolation ON business_stage_history
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS business_competitors_tenant_isolation ON business_competitors;
CREATE POLICY business_competitors_tenant_isolation ON business_competitors
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS business_artifacts_tenant_isolation ON business_artifacts;
CREATE POLICY business_artifacts_tenant_isolation ON business_artifacts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS business_stage_data_tenant_isolation ON business_stage_data;
CREATE POLICY business_stage_data_tenant_isolation ON business_stage_data
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
