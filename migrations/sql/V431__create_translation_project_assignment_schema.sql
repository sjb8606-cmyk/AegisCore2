CREATE TABLE IF NOT EXISTS translation_projects (
  project_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  specialization TEXT NOT NULL
    CHECK (specialization IN ('general', 'legal', 'medical', 'technical', 'marketing')),
  word_count INTEGER NOT NULL CHECK (word_count > 0),
  deadline TIMESTAMPTZ NOT NULL,
  assigned_linguist_id UUID,
  status TEXT NOT NULL DEFAULT 'intake'
    CHECK (status IN ('intake', 'assigned', 'in_progress', 'qa_review', 'delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE translation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_translation_projects
  ON translation_projects
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_translation_projects_tenant
  ON translation_projects (tenant_id);

CREATE INDEX IF NOT EXISTS idx_translation_projects_client
  ON translation_projects (tenant_id, client_id);

CREATE INDEX IF NOT EXISTS idx_translation_projects_linguist
  ON translation_projects (tenant_id, assigned_linguist_id);
