CREATE TABLE IF NOT EXISTS ag_crop_cycle (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  field_id TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  planned_plant_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  final_yield_kg NUMERIC,
  harvest_lot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ag_crop_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  crop_cycle_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ag_crop_cycle_field
  ON ag_crop_cycle(tenant_id, field_id);
CREATE INDEX IF NOT EXISTS idx_ag_crop_event_cycle
  ON ag_crop_event(tenant_id, crop_cycle_id, created_at);
