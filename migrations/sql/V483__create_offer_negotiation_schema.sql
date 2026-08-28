CREATE TABLE IF NOT EXISTS mkt_offer (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  listing_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  list_price_cents INT NOT NULL,
  amount_cents INT NOT NULL,
  status TEXT NOT NULL,
  counter_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mkt_offer_listing
  ON mkt_offer(tenant_id, listing_id, status);
