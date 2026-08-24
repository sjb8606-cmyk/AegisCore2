CREATE TABLE IF NOT EXISTS ag_pmra_label_rate (
  pmra_registration_number TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  max_rate_per_ha NUMERIC NOT NULL,
  phi_days INT NOT NULL,
  rei_hours INT NOT NULL
);
CREATE TABLE IF NOT EXISTS ag_pesticide_application (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  field_id TEXT NOT NULL,
  crop_cycle_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  pmra_registration_number TEXT NOT NULL,
  rate_applied_per_ha NUMERIC NOT NULL,
  wind_speed_kmh NUMERIC NOT NULL,
  weather_conditions TEXT,
  phi_unlock_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ag_harvest_lock (
  tenant_id UUID NOT NULL,
  field_id TEXT NOT NULL,
  locked BOOLEAN NOT NULL,
  unlock_at TIMESTAMPTZ,
  reason TEXT,
  application_id UUID,
  PRIMARY KEY (tenant_id, field_id)
);
-- NOTE: seed pmra_label_rate from authoritative Health Canada PMRA data — not guessed.
