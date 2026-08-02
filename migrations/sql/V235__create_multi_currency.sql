CREATE TABLE exchange_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  base_currency   VARCHAR(3) NOT NULL,
  quote_currency  VARCHAR(3) NOT NULL,
  rate            NUMERIC NOT NULL CHECK (rate > 0),
  effective_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exchange_rates_tenant_pair ON exchange_rates(tenant_id, base_currency, quote_currency, effective_at DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_exchange_rates ON exchange_rates
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
