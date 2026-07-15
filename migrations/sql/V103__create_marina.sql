DROP TABLE IF EXISTS marina_maintenance CASCADE;
DROP TABLE IF EXISTS marina_fuel_logs CASCADE;
DROP TABLE IF EXISTS marina_reservations CASCADE;
DROP TABLE IF EXISTS marina_vessels CASCADE;
DROP TABLE IF EXISTS marina_slips CASCADE;

CREATE TABLE marina_slips (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(50) NOT NULL,
  size_limit_m    NUMERIC(6,2) NOT NULL,
  depth_limit_m   NUMERIC(6,2) NOT NULL,
  status          VARCHAR(30) DEFAULT 'available' CHECK (status IN ('available','occupied','reserved','maintenance','blocked')),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE marina_vessels (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  owner_name      VARCHAR(255) NOT NULL,
  length_m        NUMERIC(6,2) NOT NULL,
  draft_m         NUMERIC(6,2) NOT NULL,
  beam_m          NUMERIC(6,2),
  status          VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active','docked','in_transit','maintenance')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE marina_reservations (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  slip_id             UUID REFERENCES marina_slips(id) ON DELETE SET NULL,
  vessel_id           UUID REFERENCES marina_vessels(id) ON DELETE CASCADE,
  confirmation_number VARCHAR(50) NOT NULL,
  start_time          TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time            TIMESTAMP WITH TIME ZONE NOT NULL,
  status              VARCHAR(30) DEFAULT 'booked' CHECK (status IN ('booked','active','completed','canceled')),
  guest_name          VARCHAR(255),
  guest_email         VARCHAR(255),
  total_cents         BIGINT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, confirmation_number)
);

CREATE TABLE marina_fuel_logs (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  vessel_id         UUID NOT NULL REFERENCES marina_vessels(id) ON DELETE CASCADE,
  liters            NUMERIC(10,2) NOT NULL,
  price_per_liter   NUMERIC(10,2) NOT NULL,
  total_cost        NUMERIC(14,2) GENERATED ALWAYS AS (liters * price_per_liter) STORED,
  logged_by         UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE marina_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE marina_vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE marina_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE marina_fuel_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_slips ON marina_slips USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_vessels ON marina_vessels USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_reservations ON marina_reservations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_fuel ON marina_fuel_logs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_slips_tenant_status ON marina_slips(tenant_id, status);
CREATE INDEX idx_reservations_slip_time ON marina_reservations(slip_id, start_time, end_time);
CREATE INDEX idx_reservations_vessel ON marina_reservations(vessel_id);
CREATE INDEX idx_fuel_vessel ON marina_fuel_logs(vessel_id, created_at DESC);
