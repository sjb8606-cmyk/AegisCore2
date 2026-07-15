-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS expense_approvals CASCADE;
DROP TABLE IF EXISTS expense_items CASCADE;
DROP TABLE IF EXISTS expense_reports CASCADE;

CREATE TABLE expense_reports (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  report_number     VARCHAR(50) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','reimbursed','rejected')),
  employee_id       UUID NOT NULL,
  total_cents       BIGINT DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, report_number)
);

CREATE TABLE expense_items (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  report_id       UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  category        VARCHAR(100) NOT NULL,
  merchant_name   VARCHAR(255),
  expense_date    DATE NOT NULL,
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  receipt_file_id UUID
);

CREATE TABLE expense_approvals (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  report_id       UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  approver_id     UUID NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason          TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP WITH TIME ZONE
);

ALTER TABLE expense_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_exp_reports ON expense_reports USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_exp_items ON expense_items USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_exp_approvals ON expense_approvals USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_exp_reports_tenant ON expense_reports(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exp_items_report ON expense_items(report_id);
CREATE INDEX IF NOT EXISTS idx_exp_approvals_report ON expense_approvals(report_id);
