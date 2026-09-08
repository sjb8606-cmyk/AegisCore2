CREATE TABLE IF NOT EXISTS employee_expenses (
  expense_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  category TEXT NOT NULL,
  receipt_image_url TEXT NOT NULL,
  ocr_extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_status TEXT NOT NULL CHECK (
    approval_status IN (
      'submitted',
      'approved',
      'rejected',
      'reimbursed'
    )
  ),
  approver_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_employee_expense_amount
    CHECK (amount > 0)
);

ALTER TABLE employee_expenses
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE employee_expenses
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_employee_expenses
  ON employee_expenses
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE INDEX IF NOT EXISTS
  idx_employee_expenses_employee
  ON employee_expenses (
    tenant_id,
    employee_id
  );

CREATE INDEX IF NOT EXISTS
  idx_employee_expenses_status
  ON employee_expenses (
    tenant_id,
    approval_status
  );

CREATE INDEX IF NOT EXISTS
  idx_employee_expenses_created
  ON employee_expenses (
    tenant_id,
    created_at
  );
