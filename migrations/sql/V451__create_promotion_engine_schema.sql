CREATE TABLE IF NOT EXISTS ec_promotion (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC NOT NULL,
  min_subtotal_cents INT NOT NULL DEFAULT 0,
  stack_policy TEXT NOT NULL,
  max_redemptions INT,
  redemption_count INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ec_promo_code
  ON ec_promotion(tenant_id, code);
CREATE TABLE IF NOT EXISTS ec_promotion_redemption (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  promotion_id UUID NOT NULL,
  cart_id TEXT NOT NULL,
  discount_cents INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
