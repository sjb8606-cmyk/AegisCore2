-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS pos_transactions CASCADE;
DROP TABLE IF EXISTS pos_sessions CASCADE;

CREATE TABLE pos_sessions (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  register_id         VARCHAR(50) NOT NULL,
  opened_by           UUID NOT NULL,
  opening_cash_cents  BIGINT NOT NULL,
  closed_by           UUID,
  closing_cash_cents  BIGINT,
  status              VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  closed_at           TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, register_id, status)
);

CREATE TABLE pos_transactions (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  session_id          UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  cashier_id          UUID NOT NULL,
  total_amount_cents  BIGINT NOT NULL,
  items               JSONB NOT NULL DEFAULT '[]',
  payments            JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sessions ON pos_sessions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_pos_tx ON pos_transactions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_pos_sessions_tenant ON pos_sessions(tenant_id, register_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_tx_session ON pos_transactions(session_id);
