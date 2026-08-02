CREATE TABLE gift_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  code                  VARCHAR(32) NOT NULL,
  initial_balance_cents INTEGER NOT NULL CHECK (initial_balance_cents > 0),
  current_balance_cents INTEGER NOT NULL CHECK (current_balance_cents >= 0),
  issued_to_email       VARCHAR(320) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'voided')),
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  redeemed_at           TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_gift_cards_tenant_created ON gift_cards(tenant_id, created_at DESC);

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_gift_cards ON gift_cards
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
