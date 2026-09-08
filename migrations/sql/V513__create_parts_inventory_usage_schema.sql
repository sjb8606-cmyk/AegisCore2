CREATE TABLE parts_inventory_usage (
  usage_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL,
  part_sku TEXT NOT NULL,
  quantity_used NUMERIC NOT NULL CHECK (
    quantity_used > 0
  ),
  source_location TEXT NOT NULL CHECK (
    source_location IN (
      'van_stock',
      'warehouse',
      'special_order'
    )
  ),
  unit_cost NUMERIC NOT NULL CHECK (
    unit_cost >= 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE parts_inventory_stock (
  tenant_id UUID NOT NULL,
  part_sku TEXT NOT NULL,
  location TEXT NOT NULL CHECK (
    location IN (
      'van_stock',
      'warehouse',
      'special_order'
    )
  ),
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (
    quantity >= 0
  ),
  reorder_point NUMERIC NOT NULL DEFAULT 5 CHECK (
    reorder_point >= 0
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (
    tenant_id,
    part_sku,
    location
  )
);

CREATE INDEX idx_parts_inventory_usage_tenant_job
  ON parts_inventory_usage (
    tenant_id,
    job_id
  );

CREATE INDEX idx_parts_inventory_usage_tenant_sku
  ON parts_inventory_usage (
    tenant_id,
    part_sku
  );

ALTER TABLE parts_inventory_usage
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE parts_inventory_usage
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_parts_inventory_usage
  ON parts_inventory_usage
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );

ALTER TABLE parts_inventory_stock
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE parts_inventory_stock
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_parts_inventory_stock
  ON parts_inventory_stock
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
