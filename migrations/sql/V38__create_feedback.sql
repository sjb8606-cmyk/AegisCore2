CREATE TABLE IF NOT EXISTS feedback_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID,
  type              VARCHAR(30) CHECK (type IN ('bug','feature','ux','general')),
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(30) DEFAULT 'new' CHECK (status IN ('new','triaged','planned','in_progress','resolved','rejected')),
  severity          INTEGER DEFAULT 1,
  priority          INTEGER DEFAULT 1,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  feedback_id       UUID NOT NULL REFERENCES feedback_items(id),
  file_url          TEXT NOT NULL,
  file_type         VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_votes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  feedback_id       UUID NOT NULL REFERENCES feedback_items(id),
  user_id           UUID NOT NULL,
  vote              INTEGER CHECK (vote IN (1)),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, feedback_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback_tags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  feedback_id       UUID NOT NULL REFERENCES feedback_items(id),
  tag               VARCHAR(100),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_assignees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  feedback_id       UUID NOT NULL REFERENCES feedback_items(id),
  assigned_to       UUID,
  assigned_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  feedback_id       UUID NOT NULL REFERENCES feedback_items(id),
  note              TEXT NOT NULL,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE feedback_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_items FORCE ROW LEVEL SECURITY;

ALTER TABLE feedback_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_attachments FORCE ROW LEVEL SECURITY;

ALTER TABLE feedback_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_votes FORCE ROW LEVEL SECURITY;

ALTER TABLE feedback_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_tags FORCE ROW LEVEL SECURITY;

ALTER TABLE feedback_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_assignees FORCE ROW LEVEL SECURITY;

ALTER TABLE feedback_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_notes FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_feedback ON feedback_items 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_attachments ON feedback_attachments 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_votes ON feedback_votes 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_tags ON feedback_tags 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_assignees ON feedback_assignees 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_notes ON feedback_notes 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_items(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_feedback ON feedback_votes(feedback_id);
CREATE INDEX IF NOT EXISTS idx_notes_feedback ON feedback_notes(feedback_id);
