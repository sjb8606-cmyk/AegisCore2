CREATE TABLE escrow_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  counterparty_id UUID NOT NULL,
  amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
  currency       VARCHAR(3) NOT NULL DEFAULT 'USD',
  status         VARCHAR(20) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded', 'disputed')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_escrow_accounts_tenant_user ON escrow_accounts(tenant_id, user_id, created_at DESC);

ALTER TABLE escrow_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_escrow_accounts ON escrow_accounts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
