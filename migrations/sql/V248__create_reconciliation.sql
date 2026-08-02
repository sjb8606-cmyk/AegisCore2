CREATE TABLE reconciliation_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  account         VARCHAR(100) NOT NULL,
  statement_total_cents  BIGINT NOT NULL,
  ledger_total_cents     BIGINT NOT NULL,
  discrepancy_cents      BIGINT GENERATED ALWAYS AS (statement_total_cents - ledger_total_cents) STORED,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_reconciliation_records_tenant_account ON reconciliation_records(tenant_id, account, created_at DESC);

ALTER TABLE reconciliation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_reconciliation_records ON reconciliation_records
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
