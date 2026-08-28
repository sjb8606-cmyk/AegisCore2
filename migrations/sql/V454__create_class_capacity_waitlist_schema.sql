CREATE TABLE IF NOT EXISTS fit_class_session (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL,
  booked_count INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fit_class_booking (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  class_id UUID NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL,
  waitlist_position INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fit_booking_class
  ON fit_class_booking(tenant_id, class_id, status);
