CREATE TABLE IF NOT EXISTS marina_meter_state (
  tenant_id UUID NOT NULL,
  slip_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  last_reading NUMERIC NOT NULL DEFAULT 0,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, slip_id, kind)
);
CREATE TABLE IF NOT EXISTS marina_meter_reading (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  slip_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reading NUMERIC NOT NULL,
  usage NUMERIC NOT NULL,
  charge_cents INT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marina_meter_slip
  ON marina_meter_reading(tenant_id, slip_id, read_at);
