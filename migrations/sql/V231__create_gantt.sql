CREATE TABLE gantt_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  project_name  VARCHAR(255) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL CHECK (end_date >= start_date),
  progress_pct  SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gantt_items_tenant_project ON gantt_items(tenant_id, project_name, start_date);

ALTER TABLE gantt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE gantt_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gantt_items ON gantt_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
