-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS report_runs CASCADE;
DROP TABLE IF EXISTS report_schedules CASCADE;
DROP TABLE IF EXISTS report_definitions CASCADE;

CREATE TABLE report_definitions (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  created_by   UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  type         VARCHAR(30) NOT NULL CHECK (type IN ('revenue','customers','operations','compliance','custom')),
  config       JSONB NOT NULL DEFAULT '{}',
  is_shared    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at   TIMESTAMP WITH TIME ZONE
);

CREATE TABLE report_schedules (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  report_id       UUID NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  cron_expression VARCHAR(50) NOT NULL,
  recipients      JSONB DEFAULT '[]',
  format          VARCHAR(10) DEFAULT 'csv' CHECK (format IN ('pdf','csv','json')),
  last_run_at     TIMESTAMP WITH TIME ZONE,
  next_run_at     TIMESTAMP WITH TIME ZONE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE report_runs (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  report_id     UUID NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  format        VARCHAR(10) DEFAULT 'csv',
  file_url      TEXT,
  row_count     INTEGER,
  duration_ms   INTEGER,
  error         TEXT,
  triggered_by  UUID,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMP WITH TIME ZONE
);

ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_defs ON report_definitions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_schedules ON report_schedules USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_runs ON report_runs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_report_defs_tenant ON report_definitions(tenant_id, type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_report_runs ON report_runs(report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_next ON report_schedules(next_run_at) WHERE is_active = true;
