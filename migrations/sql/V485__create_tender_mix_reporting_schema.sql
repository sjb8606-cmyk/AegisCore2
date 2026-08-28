CREATE TABLE IF NOT EXISTS pos_tender_line (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  shift_id TEXT,
  tender_type TEXT NOT NULL,
  amount_cents INT NOT NULL,
  direction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pos_tender_session
  ON pos_tender_line(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_pos_tender_shift
  ON pos_tender_line(tenant_id, shift_id);
