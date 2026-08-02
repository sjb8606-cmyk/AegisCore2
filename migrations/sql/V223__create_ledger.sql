CREATE TABLE ledger_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  account       VARCHAR(100) NOT NULL,
  entry_type    VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      VARCHAR(3) NOT NULL DEFAULT 'USD',
  description   TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ledger_entries_tenant_account ON ledger_entries(tenant_id, account, created_at DESC);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ledger_entries ON ledger_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
