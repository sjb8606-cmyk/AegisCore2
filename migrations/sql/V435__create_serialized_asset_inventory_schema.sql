CREATE TABLE serialized_asset_inventory (
  asset_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sku TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  condition TEXT NOT NULL
    CHECK (
      condition IN (
        'excellent',
        'good',
        'fair',
        'needs_repair'
      )
    ),
  current_status TEXT NOT NULL
    CHECK (
      current_status IN (
        'available',
        'rented',
        'in_maintenance',
        'retired'
      )
    ),
  purchase_date TIMESTAMPTZ NOT NULL,
  current_location TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_serialized_asset_inventory_tenant_serial
  ON serialized_asset_inventory (
    tenant_id,
    serial_number
  );

CREATE INDEX idx_serialized_asset_inventory_tenant_sku_status
  ON serialized_asset_inventory (
    tenant_id,
    sku,
    current_status
  );

ALTER TABLE serialized_asset_inventory
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE serialized_asset_inventory
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_serialized_asset_inventory
  ON serialized_asset_inventory
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );
