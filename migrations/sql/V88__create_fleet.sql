-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS fleet_maintenance CASCADE;
DROP TABLE IF EXISTS driver_assignments CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;

CREATE TABLE vehicles (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  vehicle_number    VARCHAR(50) NOT NULL,
  vin               VARCHAR(50),
  make              VARCHAR(100) NOT NULL,
  model             VARCHAR(100) NOT NULL,
  year              INTEGER NOT NULL,
  license_plate     VARCHAR(50),
  fuel_type         VARCHAR(50),
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','maintenance','retired','sold')),
  odometer_km       NUMERIC DEFAULT 0,
  assigned_to       UUID,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, vehicle_number),
  UNIQUE(tenant_id, vin)
);

CREATE TABLE driver_assignments (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  vehicle_id    UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id     UUID NOT NULL,
  assigned_by   UUID NOT NULL,
  assigned_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  returned_at   TIMESTAMP WITH TIME ZONE,
  start_km      NUMERIC,
  end_km        NUMERIC,
  notes         TEXT
);

CREATE TABLE fleet_maintenance (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type VARCHAR(100) NOT NULL,
  description      TEXT NOT NULL,
  cost_cents       BIGINT DEFAULT 0,
  odometer_km      NUMERIC,
  next_due_km      NUMERIC,
  status           VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  performed_at     TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vehicles ON vehicles USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_assignments ON driver_assignments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_maintenance ON fleet_maintenance USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_vehicle ON driver_assignments(vehicle_id, returned_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON fleet_maintenance(vehicle_id, status);
