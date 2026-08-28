CREATE TABLE IF NOT EXISTS hr_leave_balance (
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  balance_days NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, employee_id, leave_type)
);
CREATE TABLE IF NOT EXISTS hr_leave_request (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_req_emp
  ON hr_leave_request(tenant_id, employee_id, status);
