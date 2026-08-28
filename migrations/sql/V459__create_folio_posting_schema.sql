CREATE TABLE IF NOT EXISTS hosp_folio (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  guest_name TEXT NOT NULL,
  status TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]',
  balance_cents INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hosp_folio_res
  ON hosp_folio(tenant_id, reservation_id);
