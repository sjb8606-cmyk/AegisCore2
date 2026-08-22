CREATE TABLE IF NOT EXISTS slot (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  service_type TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  status TEXT NOT NULL,
  booked_by TEXT,
  booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_slot_available
  ON slot(tenant_id, service_type, status, start_time);
