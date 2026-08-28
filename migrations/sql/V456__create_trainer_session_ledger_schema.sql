CREATE TABLE IF NOT EXISTS fit_session_package (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  member_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  total_sessions INT NOT NULL,
  remaining_sessions INT NOT NULL,
  purchase_cents INT NOT NULL,
  trainer_payout_cents_per_session INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fit_session_burn (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  package_id UUID NOT NULL,
  member_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL,
  payout_cents INT NOT NULL,
  notes TEXT,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fit_burn_trainer
  ON fit_session_burn(tenant_id, trainer_id, occurred_at);
