CREATE TABLE IF NOT EXISTS hr_termination_case (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  effective_date TIMESTAMPTZ NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  access_revoked BOOLEAN NOT NULL DEFAULT false,
  final_pay_ready BOOLEAN NOT NULL DEFAULT false,
  tasks JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hr_term_emp
  ON hr_termination_case(tenant_id, employee_id, status);
