CREATE TABLE IF NOT EXISTS sch_resource (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sch_resource_booking (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  appointment_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sch_booking_resource
  ON sch_resource_booking(tenant_id, resource_id, start_at, status);
