-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS report_generation_runs CASCADE;
DROP TABLE IF EXISTS report_templates CASCADE;

CREATE TABLE report_templates (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20) DEFAULT 'custom' CHECK (type IN ('executive','board','grant','compliance','custom')),
  prompt_template TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);

CREATE TABLE report_generation_runs (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  template_id     UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  format          VARCHAR(10) DEFAULT 'markdown' CHECK (format IN ('markdown','pdf','docx')),
  result_body     TEXT,
  file_url        VARCHAR(512),
  created_by      UUID NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_templates ON report_templates USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_runs ON report_generation_runs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON report_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rep_runs_tenant ON report_generation_runs(tenant_id, status);
