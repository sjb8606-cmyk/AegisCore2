CREATE TABLE IF NOT EXISTS marina_waitlist (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vessel_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  preferred_slip_id TEXT,
  deposit_cents INT NOT NULL,
  deposit_held BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL,
  position INT NOT NULL,
  offered_at TIMESTAMPTZ,
  offer_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_marina_waitlist_status
  ON marina_waitlist(tenant_id, status, position);
