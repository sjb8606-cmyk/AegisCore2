CREATE TABLE IF NOT EXISTS hr_org_node (
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  manager_id TEXT,
  title TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_hr_org_manager
  ON hr_org_node(tenant_id, manager_id);
