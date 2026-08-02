CREATE TABLE discount_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  code              VARCHAR(50) NOT NULL,
  discount_type     VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
  discount_value    INTEGER NOT NULL CHECK (discount_value > 0),
  max_redemptions   INTEGER,
  redemption_count  INTEGER NOT NULL DEFAULT 0,
  expires_at        TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_discount_codes_tenant_created ON discount_codes(tenant_id, created_at DESC);

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_discount_codes ON discount_codes
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
