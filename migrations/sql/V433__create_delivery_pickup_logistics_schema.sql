CREATE TABLE IF NOT EXISTS delivery_pickup_logistics (
  logistics_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_date TIMESTAMPTZ NOT NULL,
  pickup_date TIMESTAMPTZ,
  transport_fee NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (transport_fee >= 0),
  status TEXT NOT NULL CHECK (
    status IN ('scheduled', 'delivered', 'picked_up')
  ),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE delivery_pickup_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_pickup_logistics FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_delivery_pickup_logistics
  ON delivery_pickup_logistics
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE INDEX IF NOT EXISTS idx_delivery_pickup_logistics_tenant_reservation
  ON delivery_pickup_logistics (tenant_id, reservation_id);

CREATE INDEX IF NOT EXISTS idx_delivery_pickup_logistics_tenant_dates
  ON delivery_pickup_logistics (tenant_id, delivery_date, pickup_date);
