-- @platform/mock-data — seed templates + generation runs

CREATE TABLE IF NOT EXISTS mock_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key             VARCHAR(100) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  entity_type     VARCHAR(100) NOT NULL,
  field_specs     JSONB NOT NULL DEFAULT '[]',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS mock_generation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id     UUID REFERENCES mock_templates(id) ON DELETE SET NULL,
  entity_type     VARCHAR(100) NOT NULL,
  record_count    INTEGER NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending','completed','failed')),
  sample          JSONB NOT NULL DEFAULT '[]',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_templates_tenant ON mock_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mock_runs_tenant ON mock_generation_runs (tenant_id, created_at DESC);

ALTER TABLE mock_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_generation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_mock_templates ON mock_templates;
CREATE POLICY tenant_isolation_mock_templates ON mock_templates
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_mock_runs ON mock_generation_runs;
CREATE POLICY tenant_isolation_mock_runs ON mock_generation_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
