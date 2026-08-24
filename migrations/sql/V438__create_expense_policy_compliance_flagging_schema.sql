CREATE TABLE IF NOT EXISTS expense_policy_rules (
  rule_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_code TEXT NOT NULL,
  category TEXT,
  max_amount NUMERIC(14,2),
  severity TEXT NOT NULL CHECK (
    severity IN (
      'warning',
      'requires_justification',
      'blocked'
    )
  ),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_expense_policy_max_amount
    CHECK (
      max_amount IS NULL
      OR max_amount > 0
    )
);

CREATE TABLE IF NOT EXISTS expense_policy_flags (
  flag_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  expense_id UUID NOT NULL,
  policy_rule_violated TEXT NOT NULL,
  flag_reason TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (
    severity IN (
      'warning',
      'requires_justification',
      'blocked'
    )
  ),
  employee_justification TEXT,
  overridden BOOLEAN NOT NULL DEFAULT FALSE,
  overridden_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_policy_rules
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE expense_policy_rules
  FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_policy_flags
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE expense_policy_flags
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_expense_policy_rules
  ON expense_policy_rules
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE POLICY tenant_isolation_expense_policy_flags
  ON expense_policy_flags
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_expense_policy_rule_code
  ON expense_policy_rules (
    tenant_id,
    rule_code
  );

CREATE INDEX IF NOT EXISTS
  idx_expense_policy_flags_expense
  ON expense_policy_flags (
    tenant_id,
    expense_id
  );

CREATE INDEX IF NOT EXISTS
  idx_expense_policy_flags_severity
  ON expense_policy_flags (
    tenant_id,
    severity
  );
