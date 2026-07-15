DROP TABLE IF EXISTS salon_sales CASCADE;
DROP TABLE IF EXISTS salon_appointments CASCADE;
DROP TABLE IF EXISTS salon_services CASCADE;
DROP TABLE IF EXISTS salon_staff CASCADE;
DROP TABLE IF EXISTS salon_customers CASCADE;

CREATE TABLE salon_customers (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255),
  phone          VARCHAR(50),
  loyalty_points INTEGER DEFAULT 0 NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_staff (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(100) NOT NULL,
  is_active      BOOLEAN DEFAULT true NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_services (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  name             VARCHAR(255) NOT NULL,
  price_cents      BIGINT NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_appointments (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  customer_id  UUID NOT NULL REFERENCES salon_customers(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES salon_staff(id) ON DELETE CASCADE,
  service_id   UUID NOT NULL REFERENCES salon_services(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status       VARCHAR(50) DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'canceled')),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salon_sales (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  appointment_id UUID NOT NULL REFERENCES salon_appointments(id) ON DELETE CASCADE,
  total_cents    BIGINT NOT NULL,
  points_earned  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE salon_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customers ON salon_customers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_staff ON salon_staff USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_services ON salon_services USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_appointments ON salon_appointments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_sales ON salon_sales USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Double-Booking Prevention: Unique partial index to prevent conflict bookings on active slots
CREATE UNIQUE INDEX idx_salon_no_double_booking 
ON salon_appointments (tenant_id, staff_id, scheduled_at) 
WHERE status != 'canceled';

CREATE INDEX IF NOT EXISTS idx_salon_appointments_status ON salon_appointments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_salon_sales_appointment ON salon_sales(appointment_id);
