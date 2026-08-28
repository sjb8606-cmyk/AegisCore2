CREATE TABLE IF NOT EXISTS mkt_listing (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]',
  rejection_reason TEXT,
  takedown_reason TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mkt_listing_status
  ON mkt_listing(tenant_id, status);
