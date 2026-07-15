DROP TABLE IF EXISTS fit_check_ins CASCADE;
DROP TABLE IF EXISTS fit_bookings CASCADE;
DROP TABLE IF EXISTS fit_classes CASCADE;
DROP TABLE IF EXISTS fit_members CASCADE;

CREATE TABLE fit_members (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  status     VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fit_classes (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  name         VARCHAR(255) NOT NULL,
  trainer_name VARCHAR(255) NOT NULL,
  capacity     INTEGER NOT NULL CHECK (capacity > 0),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fit_bookings (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  class_id   UUID NOT NULL REFERENCES fit_classes(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES fit_members(id) ON DELETE CASCADE,
  status     VARCHAR(50) DEFAULT 'booked' CHECK (status IN ('booked', 'waitlisted', 'canceled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fit_check_ins (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  member_id  UUID NOT NULL REFERENCES fit_members(id) ON DELETE CASCADE,
  class_id   UUID NOT NULL REFERENCES fit_classes(id) ON DELETE CASCADE,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE fit_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE fit_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fit_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fit_check_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_members ON fit_members USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_classes ON fit_classes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_bookings ON fit_bookings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_check_ins ON fit_check_ins USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Ensure a member cannot have multiple active bookings/waitlist entries for the exact same class
CREATE UNIQUE INDEX idx_fit_no_duplicate_booking 
ON fit_bookings (tenant_id, class_id, member_id) 
WHERE status != 'canceled';

CREATE INDEX IF NOT EXISTS idx_fit_bookings_lookup ON fit_bookings(class_id, status);
CREATE INDEX IF NOT EXISTS idx_fit_check_ins_lookup ON fit_check_ins(member_id, class_id);
