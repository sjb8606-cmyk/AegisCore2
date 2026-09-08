CREATE TABLE salt_brine_application_log (
  application_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  property_id UUID NOT NULL,
  material_type TEXT NOT NULL
    CHECK (
      material_type IN (
        'salt',
        'brine',
        'sand',
        'calcium_chloride'
      )
    ),
  quantity_applied NUMERIC(14,4) NOT NULL
    CHECK (quantity_applied > 0),
  gps_lat NUMERIC(9,6) NOT NULL
    CHECK (gps_lat >= -90 AND gps_lat <= 90),
  gps_lng NUMERIC(9,6) NOT NULL
    CHECK (gps_lng >= -180 AND gps_lng <= 180),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_salt_brine_application_tenant_property
  ON salt_brine_application_log (
    tenant_id,
    property_id,
    timestamp
  );

ALTER TABLE salt_brine_application_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE salt_brine_application_log
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_salt_brine_application_log
  ON salt_brine_application_log
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );
