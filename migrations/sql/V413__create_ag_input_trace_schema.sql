CREATE TABLE IF NOT EXISTS ag_input_lot (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  input_type TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  quantity_remaining NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ag_input_application (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  input_lot_id UUID NOT NULL,
  field_id TEXT NOT NULL,
  crop_cycle_id TEXT NOT NULL,
  harvest_lot_id UUID,
  quantity_used NUMERIC NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ag_input_app_harvest
  ON ag_input_application(tenant_id, harvest_lot_id);
CREATE INDEX IF NOT EXISTS idx_ag_input_app_lot
  ON ag_input_application(tenant_id, input_lot_id);
