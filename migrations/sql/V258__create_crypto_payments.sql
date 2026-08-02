CREATE TABLE crypto_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID NOT NULL,
  currency_code  VARCHAR(10) NOT NULL,
  amount         NUMERIC NOT NULL CHECK (amount > 0),
  wallet_address VARCHAR(255) NOT NULL,
  tx_hash        VARCHAR(255),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  confirmed_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_crypto_payments_tenant_user ON crypto_payments(tenant_id, user_id, created_at DESC);

ALTER TABLE crypto_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_crypto_payments ON crypto_payments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
