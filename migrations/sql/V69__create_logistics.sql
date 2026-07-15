-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS driver_locations CASCADE;
DROP TABLE IF EXISTS shipment_events CASCADE;
DROP TABLE IF EXISTS shipments CASCADE;

CREATE TABLE shipments (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  tracking_number   VARCHAR(50) NOT NULL,
  tracking_token    VARCHAR(64) NOT NULL,
  status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_transit','out_for_delivery','delivered','failed','returned')),
  sender_name       VARCHAR(255) NOT NULL,
  sender_address    JSONB NOT NULL DEFAULT '{}',
  recipient_name    VARCHAR(255) NOT NULL,
  recipient_address JSONB NOT NULL DEFAULT '{}',
  recipient_email   VARCHAR(255),
  weight_kg         NUMERIC,
  description       TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, tracking_number)
);

CREATE TABLE shipment_events (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  shipment_id   UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL,
  location      VARCHAR(255),
  description   TEXT,
  created_by    UUID,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE driver_locations (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  driver_id   UUID NOT NULL,
  lat         NUMERIC NOT NULL,
  lon         NUMERIC NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, driver_id)
);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shipments ON shipments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_events ON shipment_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_locations ON driver_locations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_shipment ON shipment_events(shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_driver ON driver_locations(tenant_id, driver_id);
