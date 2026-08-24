CREATE TABLE estimate_to_invoice_workflow (
  job_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL UNIQUE,
  labor_hours NUMERIC NOT NULL CHECK (
    labor_hours >= 0
  ),
  labor_rate NUMERIC NOT NULL CHECK (
    labor_rate >= 0
  ),
  parts_cost_total NUMERIC NOT NULL DEFAULT 0 CHECK (
    parts_cost_total >= 0
  ),
  total_estimate NUMERIC NOT NULL CHECK (
    total_estimate >= 0
  ),
  final_invoice_amount NUMERIC CHECK (
    final_invoice_amount >= 0
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'estimated',
      'approved',
      'in_progress',
      'invoiced',
      'paid'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_estimate_to_invoice_tenant_job
  ON estimate_to_invoice_workflow (
    tenant_id,
    job_id
  );

CREATE INDEX idx_estimate_to_invoice_tenant_status
  ON estimate_to_invoice_workflow (
    tenant_id,
    status
  );

ALTER TABLE estimate_to_invoice_workflow
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE estimate_to_invoice_workflow
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_estimate_to_invoice_workflow
  ON estimate_to_invoice_workflow
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
