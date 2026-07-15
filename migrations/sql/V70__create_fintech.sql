-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS journal_lines CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS ledger_accounts CASCADE;

CREATE TABLE ledger_accounts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  code            VARCHAR(50) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  balance_cents   BIGINT DEFAULT 0,
  currency        VARCHAR(3) DEFAULT 'USD',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

CREATE TABLE journal_entries (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  entry_number      VARCHAR(50) NOT NULL,
  description       TEXT NOT NULL,
  reference         VARCHAR(255),
  status            VARCHAR(20) DEFAULT 'posted' CHECK (status IN ('draft','posted','voided')),
  posted_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  voided_at         TIMESTAMP WITH TIME ZONE,
  void_reason       TEXT,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, entry_number)
);

CREATE TABLE journal_lines (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  entry_id        UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  type            VARCHAR(10) NOT NULL CHECK (type IN ('debit','credit')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  description     VARCHAR(500),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_accounts ON ledger_accounts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_entries ON journal_entries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_lines ON journal_lines USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON ledger_accounts(tenant_id, code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_entries_tenant ON journal_entries(tenant_id, entry_number);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
