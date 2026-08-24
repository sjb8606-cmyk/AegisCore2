CREATE TABLE IF NOT EXISTS salon_deposit_appointment (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  deposit_cents INT NOT NULL,
  deposit_status TEXT NOT NULL,
  outcome TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS salon_client_strikes (
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  strikes INT NOT NULL DEFAULT 0,
  blocked BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_deposit_appt_client
  ON salon_deposit_appointment(tenant_id, client_id);
