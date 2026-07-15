DROP TABLE IF EXISTS transport_bookings CASCADE;
DROP TABLE IF EXISTS transport_trips CASCADE;
DROP TABLE IF EXISTS transport_routes CASCADE;

CREATE TABLE transport_routes (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  name        VARCHAR(255) NOT NULL,
  origin      TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km NUMERIC(10,2),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP WITH TIME ZONE
);

CREATE TABLE transport_trips (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  route_id       UUID NOT NULL REFERENCES transport_routes(id),
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status         VARCHAR(30) CHECK (status IN ('scheduled','boarding','in_transit','completed','canceled','delayed')),
  vehicle_id     UUID,
  driver_id      UUID,
  capacity       INTEGER NOT NULL DEFAULT 0,
  booked_seats   INTEGER DEFAULT 0,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE
);

CREATE TABLE transport_bookings (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  trip_id        UUID NOT NULL REFERENCES transport_trips(id) ON DELETE CASCADE,
  passenger_name VARCHAR(255) NOT NULL,
  seat_number    VARCHAR(20),
  status         VARCHAR(30) CHECK (status IN ('booked','checked_in','canceled','no_show')),
  fare           NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP WITH TIME ZONE
);

ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_routes ON transport_routes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_trips ON transport_trips USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_bookings ON transport_bookings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_trips_tenant_status ON transport_trips(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_trip ON transport_bookings(trip_id);
