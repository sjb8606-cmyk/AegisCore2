CREATE TABLE payroll_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  user_id          UUID NOT NULL,
  pay_period_start DATE NOT NULL,
  pay_period_end   DATE NOT NULL CHECK (pay_period_end >= pay_period_start),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'cancelled')),
  total_gross_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_gross_cents >= 0),
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_payroll_runs_tenant_period ON payroll_runs(tenant_id, pay_period_start DESC);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payroll_runs ON payroll_runs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
