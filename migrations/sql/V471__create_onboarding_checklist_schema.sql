CREATE TABLE IF NOT EXISTS hr_onboarding_template (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  role_key TEXT NOT NULL,
  name TEXT NOT NULL,
  tasks JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS hr_onboarding_run (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  template_id UUID NOT NULL,
  role_key TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  tasks JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_onboard_emp
  ON hr_onboarding_run(tenant_id, employee_id, status);
