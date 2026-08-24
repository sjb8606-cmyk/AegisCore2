CREATE TABLE payment_on_completion (
  payment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL
    CHECK (amount >= 0),
  method TEXT NOT NULL
    CHECK (
      method IN (
        'card_on_file',
        'card_present',
        'cash',
        'other'
      )
    ),
  deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (deposit_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'paid',
        'partial',
        'refunded'
      )
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_payment_on_completion_tenant_job
  ON payment_on_completion (tenant_id, job_id);

CREATE INDEX idx_payment_on_completion_tenant_status
  ON payment_on_completion (tenant_id, status);

ALTER TABLE payment_on_completion
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_on_completion
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payment_on_completion
  ON payment_on_completion
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
